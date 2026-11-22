/** Thin OpenAI Agents SDK adapter. All execution goes through the runtime. */
import { tool as sdkTool } from "@openai/agents";
import type { FunctionTool } from "@openai/agents";
import type { ToolResult } from "@agentic-tools/core";
import type { Toolkit } from "@agentic-tools/runtime";

export class ToolExecutionError extends Error {
  readonly code: string;
  constructor(readonly toolName: string, readonly result: ToolResult) {
    super(result.status === "error" ? result.error.message : "Tool execution failed.");
    this.name = "ToolExecutionError";
    this.code = result.status === "error" ? result.error.code : "execution_error";
  }
}
export interface ToOpenAIAgentsOptions {
  /** Defaults to replacing dots with underscores for provider-safe names. */
  nameForTool?: (canonicalName: string) => string;
  /** Return the full runtime envelope as JSON, including failed calls. */
  returnEnvelope?: boolean;
}

/**
 * JSON Schema is passed unchanged with strict:false, rather than rewriting
 * optional properties into required ones. Runtime validation stays mandatory.
 * errorFunction:null preserves runtime errors instead of generic SDK fallback.
 * Native SDK approval does not bypass runtime approval. Host approvers must
 * resolve approval_required; there is no automatic SDK-interruption bridge.
 */
export function toOpenAIAgents(toolkit: Toolkit, options: ToOpenAIAgentsOptions = {}): FunctionTool<any, any, any>[] {
  const seen = new Set<string>();
  return toolkit.listTools().map((definition) => {
    const name = options.nameForTool?.(definition.name) ?? definition.name.replaceAll(".", "_");
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || seen.has(name)) {
      throw new Error("Framework tool names must be provider-safe and unique after mapping.");
    }
    seen.add(name);
    if (definition.inputSchema.type !== "object") throw new Error("OpenAI function tools require an object input schema.");
    return sdkTool({
      name,
      description: definition.description,
      parameters: definition.inputSchema as never,
      strict: false,
      errorFunction: null,
      execute: async (args: unknown, _context, details) => {
        const result = await toolkit.invoke(definition.name, args, { signal: details?.signal });
        if (options.returnEnvelope) return JSON.stringify(result);
        if (result.status === "success") return JSON.stringify(result.output) ?? "null";
        throw new ToolExecutionError(definition.name, result);
      }
    });
  });
}
