/** Complete runtime-result limits, separate from successful-payload limits. */
import { ToolError, type ToolResult } from "@agentic-tools/core";
import { estimateTokens } from "./shaping.js";

export interface ResultBudget {
  maxResultBytes: number;
  maxResultTokens?: number;
}
export const AUDIT_FAILURE_WARNING = "A configured audit sink failed. The in-memory audit stream remains available.";
const MESSAGE = "Complete result suppressed to fit its budget, including output, message, details, warnings and metadata.";
const CONTINUATION = "Retry with a smaller page or higher result budget.";

function suppressed(result: ToolResult, omitted: number): ToolResult {
  return {
    status: "error", tool: result.tool, traceId: result.traceId, timing: result.timing,
    error: {code: result.status === "error" ? result.error.code : "resource_limit", message: MESSAGE},
    truncation: {truncated: true, unit: "serialized source bytes", omitted, continuation: CONTINUATION}
  };
}
function fits(result: ToolResult, budget: ResultBudget, counter: (s: string) => number): boolean {
  // Reserve space for an audit-delivery warning before calling the sinks.
  // A sink that fails only on invocation.end must not overflow the final cap
  // or change the already-recorded terminal status.
  const text = JSON.stringify({...result, warnings: [...(result.warnings ?? []), AUDIT_FAILURE_WARNING]});
  if (Buffer.byteLength(text, "utf8") > budget.maxResultBytes) return false;
  if (budget.maxResultTokens === undefined) return true;
  for (const variant of [text, JSON.stringify(result)]) {
    let count: number;
    try { count = counter(variant); }
    catch { throw new ToolError("resource_limit", "Complete-result token counter failed."); }
    if (!Number.isSafeInteger(count) || count < 0) throw new ToolError("resource_limit", "Invalid complete-result token counter.");
    if (count > budget.maxResultTokens) return false;
  }
  return true;
}
/** Reject impossible envelope budgets before running any tool or approver. */
export function assertResultBudget(result: ToolResult, budget: ResultBudget, counter = estimateTokens): void {
  // Longest stable error code, worst-case number widths and an audit-warning
  // reserve. No identity or correlation fields are silently shortened.
  const sample = suppressed({...result, status: "error", error: {code: "approval_required", message: ""},
    timing: {startedAt: Number.MAX_SAFE_INTEGER, durationMs: Number.MAX_SAFE_INTEGER}}, Number.MAX_SAFE_INTEGER);
  if (!fits(sample, budget, counter)) {
    throw new ToolError("resource_limit", "Complete-result budget cannot fit the required envelope. Increase maxResultBytes/maxResultTokens.");
  }
}
/** Bound every field, including errors. No oversized error fallback is returned. */
export function boundResult(result: ToolResult, budget: ResultBudget, counter = estimateTokens): ToolResult {
  if (fits(result, budget, counter)) return result;
  const fallback = suppressed(result, Buffer.byteLength(JSON.stringify(result), "utf8"));
  if (!fits(fallback, budget, counter)) {
    throw new ToolError("resource_limit", "Complete-result budget cannot fit the required envelope. Increase maxResultBytes/maxResultTokens.");
  }
  return fallback;
}
