/**
 * Model-facing output shaping (PRD 8.4, FR-022).
 *
 * Results carry byte budgets, deterministic truncation with explicit
 * markers, and (at the tool level) pagination cursors. Truncation never
 * silently drops content: a TruncationInfo marker always states what was
 * cut and how to retrieve more.
 */

import type { ToolResult, ToolSuccess } from "@agentic-tools/core";

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

const CONTINUATION_HINT =
  "Output exceeded the configured budget. Re-invoke with the tool's offset/limit or cursor parameters to page through the remainder.";

/**
 * Apply a byte budget to a successful result. Deterministic: the same
 * output and budget always produce the same truncated result.
 */
export function shapeResult<T>(
  result: ToolResult<T>, maxOutputBytes: number,
  maxOutputTokens?: number, countTokens: (text: string) => number = estimateTokens
): ToolResult<T> {
  if (result.status !== "success") return result;
  const serialized = JSON.stringify(result.output) ?? "null";
  const tokens = (text: string): number => {
    const n = countTokens(text);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid token counter result");
    return n;
  };
  const fits = (output: unknown): boolean => {
    const text = JSON.stringify(output) ?? "null";
    return Buffer.byteLength(text, "utf8") <= maxOutputBytes &&
      (maxOutputTokens === undefined || tokens(text) <= maxOutputTokens);
  };
  if (fits(result.output)) return result;
  // Every candidate is measured after JSON escaping and structural overhead.
  // Binary search need not find the longest prefix for a non-monotonic host
  // tokenizer, but the chosen candidate is always independently checked.
  const prefix = <U>(length: number, candidate: (n: number) => U): U | undefined => {
    if (!fits(candidate(0))) return undefined;
    let lo = 0, hi = length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(candidate(mid))) lo = mid; else hi = mid - 1;
    }
    const output = candidate(lo);
    return fits(output) ? output : undefined;
  };
  let output: unknown;
  let unit = "bytes";
  let omitted = 0;
  let continuation = CONTINUATION_HINT;
  if (typeof result.output === "string") {
    const chars = Array.from(result.output);
    output = prefix(chars.length, n => chars.slice(0, n).join(""));
  } else if (Array.isArray(result.output)) {
    output = prefix(result.output.length, n => (result.output as unknown[]).slice(0, n));
    unit = "entries";
    omitted = result.output.length - ((output as unknown[] | undefined)?.length ?? 0);
  } else if (result.output && typeof result.output === "object" && Array.isArray((result.output as Record<string,unknown>).items)) {
    const {nextCursor: _cursor, ...page} = result.output as Record<string,unknown>;
    const items = page.items as unknown[];
    output = prefix(items.length, n => ({...page, items: items.slice(0,n)}));
    unit = "entries";
    omitted = items.length - ((output as {items:unknown[]} | undefined)?.items.length ?? 0);
    continuation = "Page shortened; nextCursor removed. Re-invoke with the SAME input cursor and smaller limit, or raise the budget if no item fits.";
  }
  if (output === undefined) {
    const chars = Array.from(serialized);
    output = prefix(chars.length, n => ({truncatedJsonPreview: chars.slice(0,n).join("")}));
    unit = "bytes";
  }
  if (output === undefined) {
    return {status:"error", tool:result.tool, traceId:result.traceId, timing:result.timing,
      error:{code:"resource_limit", message:"Output cannot fit the configured payload budget."}};
  }
  if (unit === "bytes") omitted = Math.max(0, Buffer.byteLength(serialized,"utf8") - byteLength(output));
  return {...result, output:output as T,
    truncation:{truncated:true, unit, omitted, continuation}};
}

/** Rough token estimate: 4 chars per token (PRD 8.6 context footprint). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Approximate token cost of exposing one tool definition to a model. */
export function toolFootprintTokens(tool: {
  name: string;
  description: string;
  inputSchema: unknown;
}): number {
  return estimateTokens(JSON.stringify({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

export type { ToolSuccess };
