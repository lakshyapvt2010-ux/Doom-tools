/**
 * Shared toolkit state. A derived toolkit (toolkit.select) shares the
 * parent's runtime, policy and audit stream and can only narrow, never
 * widen, the selected tool set (PRD 8.6).
 */

import type { Logger, ToolDefinition } from "@agentic-tools/core";
import type {
  ApprovalManager,
  AuditSink,
  Approver,
  Redactor,
  ResolvedPolicy
} from "@agentic-tools/security";
import type { ToolRegistry } from "./registry.js";
import type { TraceCollector } from "./trace.js";
import type { MetricsCollector } from "./metrics.js";

export interface ToolkitState {
  workspace: string;
  registry: ToolRegistry;
  /** Names exposed to this toolkit/run/server. */
  selected: ReadonlySet<string>;
  policy: ResolvedPolicy;
  approvals: ApprovalManager;
  approvers: Approver[];
  auditSinks: AuditSink[];
  redactor: Redactor;
  services: Record<string, unknown>;
  logger?: Logger;
  traces: TraceCollector;
  metrics: MetricsCollector;
  countOutputTokens?: (text: string) => number;
}

export interface SelectionCriteria {
  /** Keep tools whose name matches (string, list, or predicate). */
  name?: string | string[];
  /** Keep tools carrying ALL of these tags. */
  tag?: string | string[];
  /** Keep tools with these side effects. */
  sideEffect?: ToolDefinition["sideEffect"][];
  /** Keep tools with these risk levels. */
  risk?: ToolDefinition["risk"][];
  /** Keep tools declaring any of these capabilities. */
  capability?: string[];
}

export function narrowSelection(
  current: ReadonlySet<string>,
  registry: ToolRegistry,
  criteria: SelectionCriteria
): Set<string> {
  const names = criteria.name === undefined
    ? null
    : new Set(Array.isArray(criteria.name) ? criteria.name : [criteria.name]);
  const tags = criteria.tag === undefined
    ? null
    : new Set(Array.isArray(criteria.tag) ? criteria.tag : [criteria.tag]);
  const sideEffects = criteria.sideEffect === undefined ? null : new Set(criteria.sideEffect);
  const risks = criteria.risk === undefined ? null : new Set(criteria.risk);
  const capabilities = criteria.capability === undefined ? null : new Set(criteria.capability);

  const out = new Set<string>();
  for (const name of current) {
    const def = registry.resolve(name);
    if (!def) continue;
    if (names && !names.has(name)) continue;
    if (tags && ![...tags].every((t) => def.tags?.includes(t))) continue;
    if (sideEffects && !sideEffects.has(def.sideEffect)) continue;
    if (risks && !risks.has(def.risk)) continue;
    if (capabilities && !def.capabilities.some((c) => capabilities.has(c))) continue;
    out.add(name);
  }
  return out;
}
