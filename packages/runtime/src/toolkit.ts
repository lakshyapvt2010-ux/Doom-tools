/**
 * createToolkit — the developer-facing entry point (PRD 7.1, 8.6).
 *
 * One workspace root is the single source of truth for the boundary.
 * Selection is enforced by the runtime at invocation time: hiding a
 * schema is never the only control (FR-019). Derived toolkits share the
 * parent's runtime, policy and audit stream and can only narrow.
 *
 * The MCP server lives in @agentic-tools/adapter-mcp (serveMcp), not in
 * this package, so the runtime stays free of protocol dependencies.
 */

import { resolve } from "node:path";
import { canonicalizeCapabilityPath } from "./paths-util.js";
import { ToolError } from "@agentic-tools/core";
import type { Logger, ToolDefinition, ToolResult } from "@agentic-tools/core";
import {
  ApprovalManager, approvalInputHash,
  createRedactor,
  jsonlAuditSink,
  memoryAuditSink,
  resolvePolicy,
  type ApprovalDecision,
  type AuditEvent,
  type AuditSink,
  type Approver,
  type PolicyConfig
} from "@agentic-tools/security";
import { DeferredApprovals } from "./deferred-approvals.js";
import { snapshotInput } from "./input-snapshot.js";
import { ToolRegistry } from "./registry.js";
import { invokeTool, type InvokeOptions } from "./invoke.js";
import { toolFootprintTokens } from "./shaping.js";
import {
  narrowSelection,
  type SelectionCriteria,
  type ToolkitState
} from "./state.js";
import { TraceCollector, type TraceRecord } from "./trace.js";
import { MetricsCollector, type MetricRecord } from "./metrics.js";

export interface ToolkitOptions {
  /** Single source of truth for the filesystem boundary. */
  workspace: string;
  /** Tools to expose. Package factories return arrays; flatten them here. */
  tools: ToolDefinition[];
  /** Policy; workspace is inherited from the toolkit when omitted. */
  policy?: Omit<PolicyConfig, "workspace"> & { workspace?: string };
  /** Host-registered services, exposed per capability grants (PRD 8.3). */
  services?: Record<string, unknown>;
  /** Approvers tried in order for approval-gated calls (PRD 9.5). */
  approvers?: Approver[];
  /** Additional audit sinks (a memory sink is always present). */
  auditSinks?: AuditSink[];
  runtime?: {
    /** Only "local" exists at P0; container/remote are roadmap (PRD 14). */
    backend?: "local";
    defaultTimeoutMs?: number;
    maxOutputBytes?: number;
    /** Synchronous host tokenizer for serialized JSON payloads. Must be pure. */
    countOutputTokens?: (text: string) => number;
  };
  logger?: Logger;
}

export interface Toolkit {
  readonly workspace: string;
  /** The tools exposed to this toolkit/run (FR-019 enforcement set). */
  listTools(): ToolDefinition[];
  /** Approximate token cost of the exposed definitions (PRD 8.6). */
  describeFootprint(): { perTool: { name: string; tokens: number }[]; totalTokens: number };
  /** Run-level narrowing; returns a derived toolkit that can only narrow. */
  select(criteria: SelectionCriteria): Toolkit;
  /** Invoke an exposed tool through the full lifecycle (PRD 8.5). */
  invoke<TOutput = unknown>(
    name: string,
    input: unknown,
    options?: InvokeOptions
  ): Promise<ToolResult<TOutput>>;
  /** Resolve a pending approval out of band (PRD 9.5). */
  resolveApproval(requestId: string, decision: ApprovalDecision): boolean;
  listPendingApprovals(): ReturnType<ApprovalManager["listPending"]>;
  /** Explicitly deferred calls are separate from currently waiting approvers. */
  listDeferredApprovals(): ReturnType<DeferredApprovals["list"]>;
  discardDeferredApproval(requestId: string): boolean;
  /** Trusted host decision; exact tool/input are mandatory, tickets are single-use. */
  resumeApproval(requestId: string, decision: ApprovalDecision,
    call: {name: string; input: unknown; signal?: AbortSignal; timeoutMs?: number}): Promise<ToolResult>;
  /** Invalidate every remembered ("approve always") decision. */
  revokeRememberedApprovals(): void;
  auditEvents(): AuditEvent[];
  traceRecords(): TraceRecord[];
  /** Bounded local aggregate counters, with no payloads or telemetry. */
  metrics(): MetricRecord[];
  /** Internal state for adapters (same-process integrations only). */
  readonly _state: ToolkitState;
}

export function createToolkit(options: ToolkitOptions): Toolkit {
  const workspace = canonicalizeCapabilityPath(resolve(options.workspace), ".");
  const memorySink = memoryAuditSink();
  const auditSinks: AuditSink[] = [memorySink, ...(options.auditSinks ?? [])];
  const policy = resolvePolicy({
    ...options.policy,
    workspace: canonicalizeCapabilityPath(workspace, options.policy?.workspace ?? workspace),
    ...(options.runtime?.defaultTimeoutMs !== undefined
      ? { timeouts: { defaultMs: options.runtime.defaultTimeoutMs } }
      : {}),
    ...(options.runtime?.maxOutputBytes !== undefined
      ? { budgets: { ...options.policy?.budgets, maxOutputBytes: options.runtime.maxOutputBytes } }
      : {})
  });
  if (policy.auditJsonlPath) {
    const redactorForAudit = createRedactor({ secrets: policy.secrets });
    auditSinks.push(jsonlAuditSink(policy.auditJsonlPath, redactorForAudit));
  }
  if (options.runtime?.backend !== undefined && options.runtime.backend !== "local") {
    throw new Error(
      `Runtime backend "${String(options.runtime.backend)}" is not available at P0. Only "local" ships; container and remote backends are roadmap. Failing closed (PRD 9.3).`
    );
  }

  const registry = new ToolRegistry();
  for (const tool of options.tools) registry.register(tool);

  const state: ToolkitState = {
    workspace,
    registry,
    selected: new Set(options.tools.map((t) => t.name)),
    policy,
    deferredApprovals: new DeferredApprovals(),
    approvals: new ApprovalManager({
      redactor: createRedactor({ secrets: policy.secrets }),
      allowRememberedApprovals: policy.allowRememberedApprovals,
      rememberTtlMs: policy.rememberTtlMs,
      rememberMaxEntries: policy.rememberMaxEntries
    }),
    approvers: options.approvers ?? [],
    auditSinks,
    redactor: createRedactor({ secrets: policy.secrets }),
    services: options.services ?? {},
    traces: new TraceCollector(),
    metrics: new MetricsCollector(),
    countOutputTokens: options.runtime?.countOutputTokens,
    ...(options.logger !== undefined ? { logger: options.logger } : {})
  };

  return toolkitFromState(state);
}

function toolkitFromState(state: ToolkitState): Toolkit {
  return {
    workspace: state.workspace,
    _state: state,
    listTools() {
      return state.registry.list().filter((t) => state.selected.has(t.name));
    },
    describeFootprint() {
      const perTool = this.listTools().map((t) => ({
        name: t.name,
        tokens: toolFootprintTokens(t)
      }));
      return {
        perTool,
        totalTokens: perTool.reduce((sum, t) => sum + t.tokens, 0)
      };
    },
    select(criteria: SelectionCriteria): Toolkit {
      const narrowed = narrowSelection(state.selected, state.registry, criteria);
      return toolkitFromState({ ...state, selected: narrowed });
    },
    invoke<TOutput>(name: string, input: unknown, invokeOptions: InvokeOptions = {}) {
      return invokeTool(state, name, input, invokeOptions) as Promise<ToolResult<TOutput>>;
    },
    resolveApproval(requestId: string, decision: ApprovalDecision) {
      return state.approvals.resolveOutOfBand(requestId, decision);
    },
    listPendingApprovals() {
      return state.approvals.listPending();
    },
    listDeferredApprovals() { return state.deferredApprovals.list(); },
    discardDeferredApproval(requestId) { return state.deferredApprovals.discard(requestId); },
    async resumeApproval(requestId, decision, call) {
      const request = state.deferredApprovals.take(requestId);
      if (!request) throw new ToolError("approval_required", "Unknown, expired or already consumed approval request.");
      if (!decision || (decision.outcome !== "allow" && decision.outcome !== "deny")) throw new ToolError("validation", "Invalid approval decision.");
      let input: unknown;
      try { input = snapshotInput(call.input); }
      catch { throw new ToolError("validation", "Resume input must be plain JSON-compatible data."); }
      if (call.name !== request.tool.name || approvalInputHash(request.tool, input, request.invocation) !== request.inputHash) {
        throw new ToolError("permission_denied", "Resume input or tool differs from the approved request.");
      }
      if (decision.outcome === "deny") {
        // Selection denial produces the normal audited terminal envelope even
        // if a host has since relaxed its policy to allow this operation.
        return invokeTool({...state, selected: new Set()}, call.name, input, {traceId: request.traceId, signal: call.signal});
      }
      return invokeTool(state, call.name, input, {
        traceId: request.traceId, signal: call.signal, timeoutMs: call.timeoutMs,
        extraApprovers: [{name: "deferred-approval", async approve(current) {
          if (Date.now() >= request.expiresAt || current.tool.version !== request.tool.version ||
              current.inputHash !== request.inputHash || current.rule !== request.rule) {
            return {outcome: "deny", decidedBy: "deferred-approval", reason: "Approval expired or classified invocation/policy changed."};
          }
          return {...decision, scope: "once", decidedBy: `deferred-approval:${request.id}`};
        }}]
      }, request);
    },
    revokeRememberedApprovals() {
      state.approvals.clearRemembered();
    },
    auditEvents() {
      const sink = state.auditSinks[0] as ReturnType<typeof memoryAuditSink>;
      return sink.events;
    },
    traceRecords() {
      return state.traces.list();
    },
    metrics() {
      return state.metrics.snapshot();
    }
  };
}
