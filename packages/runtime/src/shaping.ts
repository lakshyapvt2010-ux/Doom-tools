/**
 * Model-facing output shaping (PRD 8.4, FR-022).
 *
 * Results carry byte budgets, deterministic truncation with explicit
 * markers, and (at the tool level) pagination cursors. Truncation never
 * silently drops content: a TruncationInfo marker always states what was
 * cut and how to retrieve more.
 */

import type { ToolResult, ToolSuccess, TruncationInfo } from "@agentic-tools/core";

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
}

function truncateUtf8(text: string, maxBytes: number): { text: string; omitted: number } {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return { text, omitted: 0 };
  const sliced = buf.subarray(0, maxBytes).toString("utf8");
  return { text: sliced, omitted: buf.length - Buffer.byteLength(sliced, "utf8") };
}

const CONTINUATION_HINT =
  "Output exceeded the configured budget. Re-invoke with the tool's offset/limit or cursor parameters to page through the remainder.";

/**
 * Apply a byte budget to a successful result. Deterministic: the same
 * output and budget always produce the same truncated result.
 */
export function shapeResult<T>(result: ToolResult<T>, maxOutputBytes: number): ToolResult<T> {
  if (result.status !== "success") return result;
  const size = byteLength(result.output);
  if (size <= maxOutputBytes) return result;

  const marker = (unit: string, omitted: number, continuation?: string): TruncationInfo => ({
    truncated: true,
    unit,
    omitted,
    ...(continuation !== undefined ? { continuation } : {})
  });

  // String output: cut at the byte boundary.
  if (typeof result.output === "string") {
    const { text, omitted } = truncateUtf8(result.output, maxOutputBytes);
    return {
      ...result,
      output: text as T,
      truncation: marker("bytes", omitted, CONTINUATION_HINT)
    };
  }

  // Array output: keep the largest prefix that fits.
  if (Array.isArray(result.output)) {
    const items = result.output as unknown[];
    let kept = 0;
    for (let i = 0; i < items.length; i++) {
      if (byteLength(items.slice(0, i + 1)) > maxOutputBytes) break;
      kept = i + 1;
    }
    return {
      ...result,
      output: items.slice(0, kept) as T,
      truncation: marker("entries", items.length - kept, CONTINUATION_HINT)
    };
  }

  // { items, nextCursor } paginated shape: cut items, preserve the cursor field.
  if (
    result.output !== null &&
    typeof result.output === "object" &&
    Array.isArray((result.output as Record<string, unknown>).items)
  ) {
    const obj = result.output as Record<string, unknown>;
    const items = obj.items as unknown[];
    let kept = 0;
    for (let i = 0; i < items.length; i++) {
      const candidate = { ...obj, items: items.slice(0, i + 1) };
      if (byteLength(candidate) > maxOutputBytes) break;
      kept = i + 1;
    }
    return {
      ...result,
      output: { ...obj, items: items.slice(0, kept) } as T,
      truncation: marker("entries", items.length - kept, CONTINUATION_HINT)
    };
  }

  // Generic object: emit a bounded serialized preview, clearly labeled.
  const serialized = JSON.stringify(result.output) ?? "";
  const { text, omitted } = truncateUtf8(serialized, maxOutputBytes);
  return {
    ...result,
    output: { truncatedJsonPreview: text } as T,
    truncation: marker("bytes", omitted, CONTINUATION_HINT)
  };
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
