/** Thin OpenAI Agents SDK adapter. All execution goes through the runtime. */
import { buildTools } from "./factory.js";
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
 * The default adapter still requires host runtime approvers. Use
 * createOpenAIAgentsApprovalBridge for opt-in native SDK interruption/resume;
 * SDK approval alone never bypasses the runtime.
 */
export function toOpenAIAgents(toolkit: Toolkit, options: ToOpenAIAgentsOptions = {}): FunctionTool<any, any, any>[] {
  return buildTools(toolkit, options);
}

export { createOpenAIAgentsApprovalBridge } from "./native-approval.js";
export type { OpenAIAgentsApprovalBridge } from "./native-approval.js";
