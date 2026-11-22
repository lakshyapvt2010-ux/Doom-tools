/**
 * Invocation lifecycle (PRD 8.5, FR-002/004/005/006/008/019/020/022).
 *
 * Every call, from any adapter, passes through this pipeline:
 *   1. resolve the tool in the registry
 *   2. selection check (FR-019): not exposed => permission_denied
 *   3. validate input against the canonical JSON Schema (FR-002)
 *   4. classify the invocation, clamped to declared bounds (FR-020)
 *   5. resolve trace context
 *   6. evaluate policy against the classified invocation (FR-005)
 *   7. approval flow when policy requires it (FR-006)
 *   8. select backend (local at P0) and provision scoped services
 *   9. execute with timeout, cancellation and resource limits (FR-008)
 *  10. sanitize (redact) and shape output (FR-022)
 *  11. emit trace and audit events (FR-010/FR-015)
 *  12. return the structured result
 */

import { Ajv, type ValidateFunction } from "ajv";
import { randomUUID } from "node:crypto";
import {
  ToolError,
  failure,
  type InvocationClass,
  type Logger,
  type ToolContext,
  type ToolDefinition,
  type ToolResult
} from "@agentic-tools/core";
import {
  RISK_ORDER,
  SIDE_EFFECT_ORDER,
  evaluatePolicy,
  newAuditEvent,
  type Approver,
  type PolicyDecision
} from "@agentic-tools/security";
import { shapeResult } from "./shaping.js";
import { scopeServices } from "./services.js";
import { canonicalizeCapabilityPath } from "./paths-util.js";
import type { ToolkitState } from "./state.js";

export interface InvokeOptions {
  traceId?: string;
  /** Per-call timeout override (ms); still capped by policy defaults. */
  timeoutMs?: number;
  /** Adapter-provided approvers, tried before toolkit approvers. */
  extraApprovers?: Approver[];
}

const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
const validatorCache = new WeakMap<ToolDefinition, ValidateFunction>();

function validatorFor(tool: ToolDefinition): ValidateFunction {
  let v = validatorCache.get(tool);
  if (!v) {
    v = ajv.compile(tool.inputSchema);
    validatorCache.set(tool, v);
  }
  return v;
}

function staticBounds(tool: ToolDefinition): InvocationClass {
  return {
    sideEffect: tool.sideEffect,
    risk: tool.risk,
    capabilities: tool.capabilities.map((name) => ({ name }))
  };
}

function clampIndex<T extends string>(order: readonly T[], value: T, bound: T): T {
  return order.indexOf(value) <= order.indexOf(bound) ? value : bound;
}

/**
 * Classification may narrow but never exceed the tool's declared bounds;
 * on throw or ambiguity the runtime falls back to the static upper bound
 * (fail closed, PRD 8.3, FR-020).
 */
export function classifyInvocation(tool: ToolDefinition, input: unknown): InvocationClass {
  const bounds = staticBounds(tool);
  if (!tool.classify) return bounds;
  let classified: InvocationClass;
  try {
    classified = tool.classify(input);
  } catch {
    return bounds;
  }
  if (!classified || typeof classified !== "object") return bounds;
  // The classification is untrusted data: validate its whole shape before
  // clamping. An enum value outside the known sets (a buggy or hostile
  // classify hook) fails CLOSED to the static bound - it must never sail
  // past policy evaluation as an unrecognized value (FR-020).
  const rawSideEffect: unknown = (classified as { sideEffect?: unknown }).sideEffect;
  const rawRisk: unknown = (classified as { risk?: unknown }).risk;
  const sideEffect = (SIDE_EFFECT_ORDER as readonly unknown[]).includes(rawSideEffect)
    ? (rawSideEffect as InvocationClass["sideEffect"])
    : bounds.sideEffect;
  const risk = (RISK_ORDER as readonly unknown[]).includes(rawRisk)
    ? (rawRisk as InvocationClass["risk"])
    : bounds.risk;
  const declaredCaps = new Set(tool.capabilities);
  return {
    sideEffect: clampIndex(SIDE_EFFECT_ORDER, sideEffect, bounds.sideEffect),
    risk: clampIndex(RISK_ORDER, risk, bounds.risk),
    capabilities: (Array.isArray(classified.capabilities) ? classified.capabilities : [])
      .filter((c) => c && typeof c.name === "string" && declaredCaps.has(c.name))
  };
}

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {}
};

export async function invokeTool(
  state: ToolkitState,
  name: string,
  input: unknown,
  options: InvokeOptions = {}
): Promise<ToolResult> {
  const startedAt = Date.now();
  const traceId = options.traceId ?? randomUUID();
  const audit = (event: Parameters<typeof newAuditEvent>[2] & object, type: Parameters<typeof newAuditEvent>[0]) => {
    const e = newAuditEvent(type, traceId, event);
    for (const sink of state.auditSinks) sink.record(e);
  };

  // Steps 1-2: resolve + selection enforcement (FR-019). A tool that is
  // not exposed to this toolkit/run/server is rejected with
  // permission_denied, whether the registry knows the name or not.
  const tool = state.registry.resolve(name);
  if (!tool || !state.selected.has(name)) {
    const result = failure(
      { name, version: "unknown" },
      {
        code: "permission_denied",
        message: `Tool "${name}" is not exposed to this toolkit, run or server.`
      },
      { traceId }
    );
    state.traces.record({
      traceId,
      tool: { name, version: "unknown" },
      startedAt,
      durationMs: Date.now() - startedAt,
      status: "error",
      errorCode: "permission_denied",
      policyDecision: "deny"
    });
    return result;
  }
  const toolRef = { name: tool.name, version: tool.version };
  const fail = (code: Parameters<typeof failure>[1]["code"], message: string, details?: Record<string, unknown>) =>
    failure(toolRef, details ? { code, message, details } : { code, message }, { traceId });

  audit({ tool: toolRef, metadata: { selected: true } }, "invocation.start");

  // Step 3: input validation (FR-002).
  const validate = validatorFor(tool);
  if (!validate(input)) {
    const issues = (validate.errors ?? []).map(
      (e) => `${e.instancePath || "/"}: ${e.message ?? "invalid"}`
    );
    const result = fail("validation", `Input failed schema validation for "${name}".`, {
      issues
    });
    audit({ tool: toolRef, outcome: { status: "error", errorCode: "validation", durationMs: Date.now() - startedAt } }, "invocation.end");
    return result;
  }

  // Step 4: classification (FR-020), then canonicalize capability paths
  // against the workspace so policy sees real locations (FR-007).
  const invocation = classifyInvocation(tool, input);
  for (const cap of invocation.capabilities) {
    if (typeof cap.path === "string") {
      cap.path = canonicalizeCapabilityPath(state.policy.workspace, cap.path);
    }
  }

  // Steps 5-6: policy evaluation against the classified invocation.
  const decision: PolicyDecision = evaluatePolicy(state.policy, tool, invocation);
  audit(
    {
      tool: toolRef,
      decision: decision.kind === "deny" ? `deny: ${decision.reason}` : decision.kind,
      ...(state.policy.auditPayloads
        ? { payload: state.redactor.redactValue({ input, invocation }) }
        : {})
    },
    "policy.decision"
  );
  if (decision.kind === "deny") {
    const result = fail("permission_denied", `Denied by policy: ${decision.reason}`);
    audit({ tool: toolRef, outcome: { status: "error", errorCode: "permission_denied", durationMs: Date.now() - startedAt } }, "invocation.end");
    state.traces.record({
      traceId, tool: toolRef, startedAt, durationMs: Date.now() - startedAt,
      status: "error", errorCode: "permission_denied", policyDecision: "deny"
    });
    return result;
  }

  // Step 7: approval flow (FR-006).
  let approvalOutcome: "allow" | "deny" | "unavailable" | undefined;
  if (decision.kind === "approval") {
    const request = state.approvals.createRequest(toolRef, input, invocation, decision.rule, traceId);
    audit({ tool: toolRef, decision: `requested under ${decision.rule}`, metadata: { requestId: request.id, expiresAt: request.expiresAt } }, "approval.request");

    let approval = state.approvals.rememberedDecision(request, decision.setting);
    if (!approval) {
      const approvers = [...(options.extraApprovers ?? []), ...state.approvers];
      approval = await state.approvals.requestApproval(request, approvers);
    }
    approvalOutcome = approval ? approval.outcome : "unavailable";
    audit(
      { tool: toolRef, decision: approval ? `${approval.outcome} (${approval.decidedBy ?? "unknown"})` : "no approver available", metadata: { requestId: request.id } },
      "approval.decision"
    );

    if (!approval) {
      const result = fail(
        "approval_required",
        `This call needs approval under policy rule ${decision.rule}, but no approver is available. It was not auto-approved.`,
        { approvalRequestId: request.id, expiresAt: request.expiresAt }
      );
      audit({ tool: toolRef, outcome: { status: "error", errorCode: "approval_required", durationMs: Date.now() - startedAt } }, "invocation.end");
      state.traces.record({
        traceId, tool: toolRef, startedAt, durationMs: Date.now() - startedAt,
        status: "error", errorCode: "approval_required", policyDecision: "approval", approvalOutcome
      });
      return result;
    }
    if (approval.outcome === "deny") {
      const result = fail(
        "permission_denied",
        `Approval denied${approval.reason ? `: ${approval.reason}` : "."}`,
        { approvalRequestId: request.id }
      );
      audit({ tool: toolRef, outcome: { status: "error", errorCode: "permission_denied", durationMs: Date.now() - startedAt } }, "invocation.end");
      state.traces.record({
        traceId, tool: toolRef, startedAt, durationMs: Date.now() - startedAt,
        status: "error", errorCode: "permission_denied", policyDecision: "approval", approvalOutcome
      });
      return result;
    }
  }

  // Steps 8-9: backend + bounded execution (local backend at P0).
  const timeoutMs = Math.min(
    options.timeoutMs ?? state.policy.defaultTimeoutMs,
    state.policy.defaultTimeoutMs
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new ToolError(
          "timeout",
          `Timed out after ${timeoutMs}ms. The runtime stopped waiting; work already started by a non-cooperative tool may still be running on the host.`
        )
      ),
    timeoutMs
  );
  const context: ToolContext = {
    traceId,
    signal: controller.signal,
    deadline: startedAt + timeoutMs,
    logger: state.logger ?? noopLogger,
    services: scopeServices(state.services, tool, invocation.capabilities),
    workspace: state.policy.workspace
  };

  let result: ToolResult;
  // The deadline is enforced on the RETURN, not assumed from the tool's
  // cooperation: a tool that ignores ctx.signal cannot hang the runtime.
  // HONEST LIMIT: this stops WAITING. Host-side work already started by a
  // non-cooperative tool may continue; the runtime cannot forcibly stop it
  // (PRD 16 reliability + principle 8). Cooperative tools honor the signal.
  const execPromise = Promise.resolve().then(() => tool.execute(input, context));
  // Once the race is lost, a late rejection must never crash the host.
  void execPromise.catch(() => {});
  const deadlinePromise = new Promise<ToolResult>((resolveRace) => {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      const err = reason instanceof ToolError ? reason : new ToolError("timeout", `Timed out after ${timeoutMs}ms.`);
      resolveRace(failure(toolRef, { code: err.code, message: err.message }, { traceId }));
      return;
    }
    controller.signal.addEventListener(
      "abort",
      () => {
        const reason = controller.signal.reason;
        // The timer's ToolError already carries the stopped-waiting note.
        const err = reason instanceof ToolError ? reason : new ToolError("timeout", `Timed out after ${timeoutMs}ms. The runtime stopped waiting; work already started by a non-cooperative tool may still be running on the host.`);
        resolveRace(failure(toolRef, { code: err.code, message: err.message }, { traceId }));
      },
      { once: true }
    );
  });
  try {
    result = await Promise.race([execPromise, deadlinePromise]);
    if (controller.signal.aborted && controller.signal.reason instanceof ToolError) {
      const reason = controller.signal.reason;
      result = failure(toolRef, { code: reason.code, message: reason.message }, { traceId });
    }
  } catch (err) {
    // defineTool maps throws, but a hand-built ToolDefinition may throw;
    // the runtime still guarantees the envelope (FR-009).
    const message =
      controller.signal.aborted && controller.signal.reason instanceof ToolError
        ? controller.signal.reason.message
        : "Tool execution failed.";
    const code = controller.signal.aborted ? ("timeout" as const) : ("execution_error" as const);
    result = failure(toolRef, { code, message: code === "timeout" ? message : safeMessage(err) }, { traceId });
  } finally {
    clearTimeout(timer);
  }

  // Step 10: sanitize (redact secrets) and shape (budgets/truncation).
  result.traceId = traceId;
  result.timing = { startedAt, durationMs: Date.now() - startedAt };
  result = state.redactor.redactValue(result);
  result = shapeResult(result, state.policy.maxOutputBytes);

  // Step 11: trace + audit.
  const outcome = {
    status: result.status,
    ...(result.status === "error" ? { errorCode: result.error.code } : {}),
    durationMs: Date.now() - startedAt
  } as const;
  audit(
    {
      tool: toolRef,
      outcome,
      ...(state.policy.auditPayloads
        ? { payload: state.redactor.redactValue({ result }) }
        : {})
    },
    "invocation.end"
  );
  state.traces.record({
    traceId,
    tool: toolRef,
    startedAt,
    durationMs: outcome.durationMs,
    status: result.status,
    ...(result.status === "error" ? { errorCode: result.error.code } : {}),
    policyDecision: decision.kind,
    ...(approvalOutcome !== undefined ? { approvalOutcome } : {})
  });

  // Step 12: return.
  return result;
}

function safeMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Tool execution failed.";
}
