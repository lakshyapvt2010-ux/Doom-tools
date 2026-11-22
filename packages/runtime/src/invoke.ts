import { Ajv, type ValidateFunction } from "ajv";
import { randomUUID } from "node:crypto";
import {
  ToolError, failure, isToolResult, type InvocationClass, type Logger, type ToolContext,
  type ToolDefinition, type ToolResult
} from "@agentic-tools/core";
import {
  RISK_ORDER, SIDE_EFFECT_ORDER, approvalInputHash, evaluatePolicy, newAuditEvent, type ApprovalRequest, type Approver
} from "@agentic-tools/security";
import { assertResultBudget, boundResult, AUDIT_FAILURE_WARNING, type ResultEncoder } from "./envelope.js";
import { snapshotInput } from "./input-snapshot.js";
import { shapeResult } from "./shaping.js";
import { scopeServices } from "./services.js";
import { canonicalizeCapabilityPath } from "./paths-util.js";
import type { ToolkitState } from "./state.js";
import type { TraceRecord } from "./trace.js";

export interface InvokeOptions {
  traceId?: string;
  /** Execution timeout, capped by policy. Approval has its own expiry. */
  timeoutMs?: number;
  /** Caller cancellation also cancels a pending approval. */
  signal?: AbortSignal;
  extraApprovers?: Approver[];
  /** Return a single-use process-local approval ticket without calling approvers. */
  deferApproval?: boolean;
  /** Pure trusted-host serializer. Caps include its final representation. */
  encodeResult?: ResultEncoder;
  /** Protocol transports that own stdio must not prompt on those streams. */
  excludeStdioApprovers?: boolean;
}

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
const validatorCache = new WeakMap<ToolDefinition, ValidateFunction>();
function validatorFor(tool: ToolDefinition): ValidateFunction {
  let validator = validatorCache.get(tool);
  if (!validator) {
    validator = ajv.compile(tool.inputSchema);
    validatorCache.set(tool, validator);
  }
  return validator;
}
function staticBounds(tool: ToolDefinition): InvocationClass {
  return {
    sideEffect: tool.sideEffect, risk: tool.risk,
    capabilities: tool.capabilities.map((name) => ({ name }))
  };
}
function clampIndex<T extends string>(order: readonly T[], value: T, bound: T): T {
  return order.indexOf(value) <= order.indexOf(bound) ? value : bound;
}

/** A malformed or throwing classifier falls back to ALL static bounds. */
export function classifyInvocation(tool: ToolDefinition, input: unknown): InvocationClass {
  const bounds = staticBounds(tool);
  if (!tool.classify) return bounds;
  try {
    const value = tool.classify(input);
    if (!value || typeof value !== "object" ||
        !(SIDE_EFFECT_ORDER as readonly unknown[]).includes(value.sideEffect) ||
        !(RISK_ORDER as readonly unknown[]).includes(value.risk) ||
        !Array.isArray(value.capabilities) ||
        value.capabilities.some((cap) => !cap || typeof cap !== "object" ||
          typeof cap.name !== "string" ||
          (cap.path !== undefined && typeof cap.path !== "string"))) return bounds;
    const declared = new Set(tool.capabilities);
    return {
      sideEffect: clampIndex(SIDE_EFFECT_ORDER, value.sideEffect, bounds.sideEffect),
      risk: clampIndex(RISK_ORDER, value.risk, bounds.risk),
      // Copy before canonicalizing paths so classification objects are not mutated.
      capabilities: value.capabilities.filter((cap) => declared.has(cap.name)).map((cap) => ({ ...cap }))
    };
  } catch {
    return bounds;
  }
}

/** Shared preparation for execution and native approval previews. No tool runs. */
function scopedInvocation(state: ToolkitState, tool: ToolDefinition, input: unknown): InvocationClass {
  const invocation = classifyInvocation(tool, input);
  for (const cap of invocation.capabilities) {
    if (typeof cap.path === "string") cap.path = canonicalizeCapabilityPath(state.policy.workspace, cap.path);
  }
  return invocation;
}
/** Create a deferred native-framework ticket without executing an allowed tool. */
export function prepareApproval(state: ToolkitState, name: string, rawInput: unknown): ApprovalRequest | null {
  const tool = state.registry.resolve(name);
  if (!tool || !state.selected.has(name)) throw new ToolError("permission_denied", "Tool is not exposed to this toolkit.");
  let input: unknown;
  try { input = snapshotInput(rawInput); }
  catch { throw new ToolError("validation", "Input must be plain JSON-compatible data."); }
  try {
    if (!validatorFor(tool)(input)) throw new Error();
  } catch { throw new ToolError("validation", "Input did not match the registered schema."); }
  const invocation = scopedInvocation(state, tool, input);
  const decision = evaluatePolicy(state.policy, tool, invocation);
  if (decision.kind === "deny") throw new ToolError("permission_denied", "Invocation is denied by policy.");
  if (decision.kind !== "approval") return null;
  const request = state.approvals.createRequest({name: tool.name, version: tool.version}, input, invocation, decision.rule, randomUUID());
  state.deferredApprovals.add(request);
  return state.deferredApprovals.list().find(r => r.id === request.id)!;
}

const noopLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

/** One terminal path handles sanitization, timing, traces, metrics and audit. */
export async function invokeTool(
  state: ToolkitState, name: string, input: unknown, options: InvokeOptions = {}, resumeBinding?: ApprovalRequest
): Promise<ToolResult> {
  const startedAt = Date.now();
  const traceId = options.traceId ?? randomUUID();
  const tool = state.registry.resolve(name);
  const toolRef = { name, version: tool?.version ?? "unknown" };
  const localBudget = state.policy.perToolOutputBudgets[name];
  const resultTokenCap = Math.min(state.policy.maxResultTokens ?? Infinity, localBudget?.maxResultTokens ?? Infinity);
  const resultBudget = {
    maxResultBytes: Math.min(state.policy.maxResultBytes, localBudget?.maxResultBytes ?? Infinity),
    ...(Number.isFinite(resultTokenCap) ? {maxResultTokens: resultTokenCap} : {})
  };
  assertResultBudget(failure(toolRef, {code: "resource_limit", message: ""}, {traceId}), resultBudget, state.countOutputTokens, options.encodeResult);
  let policyDecision: TraceRecord["policyDecision"] = "not_evaluated";
  let approvalOutcome: TraceRecord["approvalOutcome"];
  let auditDeliveryFailed = false;
  const audit = (type: Parameters<typeof newAuditEvent>[0], fields: Parameters<typeof newAuditEvent>[2]) => {
    const event = state.redactor.redactValue(newAuditEvent(type, traceId, fields));
    for (const sink of state.auditSinks) {
      try { sink.record(event); } catch { auditDeliveryFailed = true; }
    }
  };
  const fail = (code: Parameters<typeof failure>[1]["code"], message: string, details?: Record<string, unknown>) =>
    failure(toolRef, { code, message, ...(details ? { details } : {}) }, { traceId });
  const finish = (raw: ToolResult): ToolResult => {
    const durationMs = Date.now() - startedAt;
    let result: ToolResult;
    try {
      if (!isToolResult(raw)) throw new Error("invalid result");
      const byteBudget = Math.min(state.policy.maxOutputBytes, localBudget?.maxOutputBytes ?? Infinity);
      const tokenCap = Math.min(state.policy.maxOutputTokens ?? Infinity, localBudget?.maxOutputTokens ?? Infinity);
      result = shapeResult(state.redactor.redactValue({ ...raw, tool: toolRef, traceId, timing: { startedAt, durationMs } }), byteBudget,
        Number.isFinite(tokenCap) ? tokenCap : undefined, state.countOutputTokens);
    } catch {
      result = failure(toolRef, { code: "execution_error", message: "Tool returned an invalid or non-serializable result." }, { traceId, timing: { startedAt, durationMs } });
    }
    result = boundResult(result, resultBudget, state.countOutputTokens, options.encodeResult);
    const outcome = {
      status: result.status, durationMs,
      ...(result.status === "error" ? { errorCode: result.error.code } : {})
    };
    audit("invocation.end", {
      tool: toolRef, outcome,
      ...(state.policy.auditPayloads ? { payload: { result } } : {})
    });
    state.traces.record(state.redactor.redactValue({
      traceId, tool: toolRef, startedAt, ...outcome, policyDecision,
      ...(approvalOutcome ? { approvalOutcome } : {})
    }));
    // Only registered names become metric labels. Guessed names collapse into
    // one bucket, so untrusted inputs cannot create unbounded cardinality.
    state.metrics.record({ ...outcome, tool: tool ? tool.name : "[unknown]", policyDecision });
    if (auditDeliveryFailed) result.warnings = [...(result.warnings ?? []), AUDIT_FAILURE_WARNING];
    return result;
  };
  const cancelled = () => fail("cancelled", "Invocation cancelled by its caller. Host work already started by a non-cooperative tool may continue.");

  audit("invocation.start", { tool: toolRef, metadata: { selected: !!tool && state.selected.has(name) } });
  if (!tool || !state.selected.has(name)) {
    policyDecision = "deny";
    audit("policy.decision", { tool: toolRef, decision: "deny: tool not selected" });
    return finish(fail("permission_denied", `Tool "${name}" is not exposed to this toolkit, run or server.`));
  }
  if (options.signal?.aborted) return finish(cancelled());

  try { input = snapshotInput(input); }
  catch { return finish(fail("validation", "Input must be plain JSON-compatible data without cycles or accessors.")); }

  try {
    const validate = validatorFor(tool);
    if (!validate(input)) {
      const issues = (validate.errors ?? []).map((error) =>
        `${error.instancePath || "/"}: ${error.message ?? "invalid"}`);
      return finish(fail("validation", `Input failed schema validation for "${name}".`, { issues }));
    }
  } catch {
    return finish(fail("validation", "The registered input schema could not be evaluated. Check the tool schema."));
  }

  const invocation = scopedInvocation(state, tool, input);
  let decision = evaluatePolicy(state.policy, tool, invocation);
  if (resumeBinding && (Date.now() >= resumeBinding.expiresAt ||
      approvalInputHash(toolRef, input, invocation) !== resumeBinding.inputHash ||
      decision.kind !== "approval" || decision.rule !== resumeBinding.rule)) {
    decision = {kind: "deny", reason: "Deferred approval expired or its classified invocation/policy changed."};
  }
  policyDecision = decision.kind;
  audit("policy.decision", {
    tool: toolRef, decision: decision.kind === "deny" ? `deny: ${decision.reason}` : decision.kind,
    ...(state.policy.auditPayloads ? { payload: { input, invocation } } : {})
  });
  if (decision.kind === "deny") return finish(fail("permission_denied", `Denied by policy: ${decision.reason}`));

  if (decision.kind === "approval") {
    const request = state.approvals.createRequest(toolRef, input, invocation, decision.rule, traceId);
    audit("approval.request", {
      tool: toolRef, decision: `requested under ${decision.rule}`,
      metadata: { requestId: request.id, expiresAt: request.expiresAt }
    });
    let approval = state.approvals.rememberedDecision(request, decision.setting);
    if (!approval && options.deferApproval) {
      state.deferredApprovals.add(request);
      return finish(fail("approval_required", "Call paused for approval. Resume this exact input with its request ID before expiry.", {
        approvalRequestId: request.id, expiresAt: request.expiresAt
      }));
    }
    if (!approval) {
      const approvers = [...(options.extraApprovers ?? []), ...state.approvers]
        .filter((approver) => !options.excludeStdioApprovers || approver.usesStdio !== true);
      approval = await state.approvals.requestApproval(request, approvers, { signal: options.signal });
    }
    approvalOutcome = approval?.outcome ?? "unavailable";
    audit("approval.decision", {
      tool: toolRef, decision: approval ? `${approval.outcome} (${approval.decidedBy ?? "unknown"})` : "no approval decision",
      metadata: { requestId: request.id }
    });
    if (options.signal?.aborted) return finish(cancelled());
    if (!approval) state.deferredApprovals.add(request);
    if (!approval) return finish(fail("approval_required", "This call needs approval, but no valid decision is available. It was not auto-approved.", {
      approvalRequestId: request.id, expiresAt: request.expiresAt
    }));
    if (approval.outcome === "deny") return finish(fail("permission_denied", `Approval denied${approval.reason ? `: ${approval.reason}` : "."}`, { approvalRequestId: request.id }));
  }

  const timeoutMs = Math.min(options.timeoutMs ?? state.policy.defaultTimeoutMs, state.policy.defaultTimeoutMs);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return finish(fail("validation", "timeoutMs must be a positive finite number."));
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(new ToolError("cancelled", "Invocation cancelled by its caller. Host work already started by a non-cooperative tool may continue."));
  options.signal?.addEventListener("abort", onCallerAbort, { once: true });
  if (options.signal?.aborted) onCallerAbort();
  const timer = setTimeout(() => controller.abort(new ToolError("timeout", `Timed out after ${timeoutMs}ms. The runtime stopped waiting; host work already started by a non-cooperative tool may continue.`)), timeoutMs);
  let result: ToolResult;
  let onAbort: (() => void) | undefined;
  try {
    if (controller.signal.aborted) return finish(cancelled());
    const context: ToolContext = {
      traceId, signal: controller.signal, deadline: Date.now() + timeoutMs,
      logger: state.logger ?? noopLogger,
      services: scopeServices(state.services, tool, invocation.capabilities),
      workspace: state.policy.workspace
    };
    const execute = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return tool.execute(input, context);
    });
    // Racing stops waiting, not arbitrary host-side work. Late failures are handled.
    void execute.catch(() => {});
    const aborted = new Promise<ToolResult>((resolve) => {
      onAbort = () => {
        const reason = controller.signal.reason as ToolError;
        resolve(fail(reason.code, reason.message));
      };
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    result = await Promise.race([execute, aborted]);
    if (controller.signal.aborted) {
      const reason = controller.signal.reason as ToolError;
      result = fail(reason.code, reason.message);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason as ToolError;
      result = fail(reason.code, reason.message);
    } else {
      result = fail(error instanceof ToolError ? error.code : "execution_error", error instanceof Error ? error.message : "Tool execution failed.");
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
  }
  return finish(result);
}
