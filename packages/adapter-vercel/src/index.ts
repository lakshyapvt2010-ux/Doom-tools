/**
 * @agentic-tools/adapter-vercel — expose a toolkit as Vercel AI SDK
 * tools (PRD 10.1: one framework adapter at P0).
 *
 * Thin translation only (PRD 10.2): the adapter converts definitions and
 * results; validation, policy, approvals, redaction and audit all happen
 * in the runtime. It has no dependency on the `ai` package: the returned
 * objects match the AI SDK CoreTool shape structurally. For AI SDK v5,
 * pass `wrapSchema: jsonSchema` from the `ai` package to wrap each input
 * schema; by default the raw JSON Schema is exposed as `inputSchema`.
 *
 * Approval parity (PRD 9.5, 10.2): the AI SDK has no standard
 * human-in-the-loop primitive the adapter can rely on, so approval-gated
 * calls surface the runtime's approval_required error (thrown as a
 * ToolExecutionError carrying the stable code and resumable request ID).
 * The adapter never skips or weakens approval.
 */

import type { JSONSchema, ToolResult } from "@agentic-tools/core";
import type { Toolkit } from "@agentic-tools/runtime";

/** Structural match for a Vercel AI SDK tool (CoreTool). */
export interface VercelLikeTool {
  description: string;
  /** Raw JSON Schema, or whatever `wrapSchema` returned. */
  inputSchema: unknown;
  execute(args: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown>;
}

/** Error thrown for failed tool calls; carries the stable error code. */
export class ToolExecutionError extends Error {
  readonly code: string;
  readonly toolName: string;
  readonly result: ToolResult;
  constructor(toolName: string, result: ToolResult) {
    const message =
      result.status === "error" ? result.error.message : "Tool execution failed.";
    super(message);
    this.name = "ToolExecutionError";
    this.toolName = toolName;
    this.code = result.status === "error" ? result.error.code : "execution_error";
    this.result = result;
  }
}

export interface ToVercelAIOptions {
  /** Map canonical names to provider-safe keys, e.g. dots to underscores.
   * Collisions fail before any tools are exposed. Runtime identity is unchanged. */
  nameForTool?: (canonicalName: string) => string;
  /**
   * Wrap each JSON Schema for the target AI SDK version, e.g.
   * `jsonSchema` from the `ai` package (v5). Default: pass through.
   */
  wrapSchema?: (schema: JSONSchema) => unknown;
  /**
   * Return the full ToolResult envelope instead of throwing on failure.
   * Default false: failures throw ToolExecutionError with the stable
   * code preserved (PRD 10.2: no lost error codes).
   */
  returnEnvelope?: boolean;
}

/** Convert every exposed tool into an AI-SDK-shaped tool map. */
export function toVercelAI(
  toolkit: Toolkit,
  options: ToVercelAIOptions = {}
): Record<string, VercelLikeTool> {
  const out: Record<string, VercelLikeTool> = Object.create(null) as Record<string, VercelLikeTool>;
  for (const tool of toolkit.listTools()) {
    const exposedName = options.nameForTool?.(tool.name) ?? tool.name;
    if (!exposedName || Object.hasOwn(out, exposedName)) {
      throw new Error("Framework tool names must be non-empty and unique after mapping.");
    }
    const schema = options.wrapSchema
      ? options.wrapSchema(tool.inputSchema)
      : tool.inputSchema;
    out[exposedName] = {
      description: tool.description,
      inputSchema: schema,
      async execute(args: unknown, executionOptions?: { abortSignal?: AbortSignal }): Promise<unknown> {
        const result = await toolkit.invoke(tool.name, args ?? {}, { signal: executionOptions?.abortSignal });
        if (result.status === "error" && !options.returnEnvelope) {
          throw new ToolExecutionError(tool.name, result);
        }
        return options.returnEnvelope || result.truncation ? result : (result as { output?: unknown }).output;
      }
    };
  }
  return out;
}
