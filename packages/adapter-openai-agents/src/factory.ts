import { tool as sdkTool } from "@openai/agents";
import type { FunctionTool, RunContext } from "@openai/agents";
import type { ToolResult } from "@agentic-tools/core";
import type { Toolkit } from "@agentic-tools/runtime";
import { ToolExecutionError, type ToOpenAIAgentsOptions } from "./index.js";
interface NativeHooks {
  needsApproval(name: string, publicName: string, args: unknown, callId?: string): Promise<boolean>;
  invoke(name: string, args: unknown, context: RunContext | undefined, details?: {toolCall?: {callId: string}; signal?: AbortSignal}): Promise<ToolResult>;
}
/** Internal hook surface, not a host authority bypass. */
export function buildTools(toolkit: Toolkit, options: ToOpenAIAgentsOptions, native?: NativeHooks): FunctionTool<any, any, any>[] {
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
      ...(native ? {needsApproval: async (_context: RunContext, args: unknown, callId?: string) => native.needsApproval(definition.name, name, args, callId)} : {}),
      execute: async (args: unknown, context, details) => {
        const result = native ? await native.invoke(definition.name, args, context, details) :
          await toolkit.invoke(definition.name, args, { signal: details?.signal });
        if (options.returnEnvelope || result.truncation) return JSON.stringify(result);
        if (result.status === "success") return JSON.stringify(result.output) ?? "null";
        throw new ToolExecutionError(definition.name, result);
      }
    });
  });
}
