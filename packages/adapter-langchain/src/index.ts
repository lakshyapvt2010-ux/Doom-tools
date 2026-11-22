/**
 * @agentic-tools/adapter-langchain — expose a toolkit as LangChain tools
 * (PRD 10.1: additional framework adapters at P1).
 *
 * Thin translation only (PRD 10.2): the adapter converts definitions and
 * results; validation, policy, approvals, redaction and audit all happen
 * in the runtime. Each tool is a real DynamicStructuredTool whose schema is
 * the tool's canonical JSON Schema. LangChain 1.x validates input against
 * that schema itself before calling the tool. Parsing failures are mapped
 * to a safe validation envelope without executing the runtime callback.
 * Runtime errors retain their stable code through ToolExecutionError.
 *
 * Approval parity (PRD 9.5, 10.2): LangChain's HITL lives in LangGraph
 * interrupts, outside the tool call, so approval-gated calls surface the
 * runtime's approval_required error as a thrown ToolExecutionError carrying
 * the stable code and resumable request ID. The adapter never skips or
 * weakens approval. Successful outputs are returned as JSON strings, the
 * shape LangChain tool results expect.
 */

import { DynamicStructuredTool, ToolInputParsingException } from "@langchain/core/tools";
import { failure, type JSONSchema, type ToolResult } from "@agentic-tools/core";
import type { Toolkit } from "@agentic-tools/runtime";

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

export interface ToLangChainOptions {
  /** Map canonical names to provider-safe keys, e.g. dots to underscores.
   * Collisions fail before any tools are exposed. Runtime identity is unchanged. */
  nameForTool?: (canonicalName: string) => string;
  /**
   * Return the full ToolResult envelope instead of throwing on failure.
   * Default false: failures throw ToolExecutionError with the stable
   * code preserved (PRD 10.2: no lost error codes).
   */
  returnEnvelope?: boolean;
}

/** Convert every exposed tool into LangChain DynamicStructuredTool instances. */
export function toLangChain(
  toolkit: Toolkit,
  options: ToLangChainOptions = {}
): DynamicStructuredTool[] {
  const seen = new Set<string>();
  return toolkit.listTools().map((tool) => {
    const exposedName = options.nameForTool?.(tool.name) ?? tool.name;
    if (!exposedName || seen.has(exposedName)) {
      throw new Error("Framework tool names must be non-empty and unique after mapping.");
    }
    seen.add(exposedName);
    const exposed = new DynamicStructuredTool({
      name: exposedName,
      description: tool.description,
      schema: tool.inputSchema as JSONSchema as never,
      func: async (args: unknown, _runManager?: unknown, config?: { signal?: AbortSignal }) => {
        const result = await toolkit.invoke(tool.name, args, { signal: config?.signal });
        if (options.returnEnvelope) return JSON.stringify(result);
        if (result.status === "success") return JSON.stringify(result.output);
        throw new ToolExecutionError(tool.name, result);
      }
    });
    // invoke delegates to call in the tested SDK. Normalize framework parsing
    // errors without calling the runtime or risking a second tool execution.
    const call = exposed.call.bind(exposed);
    exposed.call = (async (...args: Parameters<typeof call>) => {
      try { return await call(...args); }
      catch (error) {
        if (!(error instanceof ToolInputParsingException)) throw error;
        const result = failure({ name: tool.name, version: tool.version }, {
          code: "validation", message: "Tool input did not match the input schema."
        });
        if (options.returnEnvelope) return JSON.stringify(result);
        throw new ToolExecutionError(tool.name, result);
      }
    }) as typeof exposed.call;
    return exposed;
  });
}
