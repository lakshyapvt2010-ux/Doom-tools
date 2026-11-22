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
 * Approval parity (PRD 9.5, 10.2): optional LangGraph interrupt mapping uses
 * runtime-owned, single-use deferred tickets. Without it, approval failures
 * retain their stable code and host approvers remain supported. The adapter
 * never skips runtime policy. Successful outputs are JSON strings.
 */

import { DynamicStructuredTool, ToolInputParsingException } from "@langchain/core/tools";
import { failure, toFailure, type JSONSchema, type ToolResult } from "@agentic-tools/core";
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

export type NativeApprovalRequest = ReturnType<Toolkit["listDeferredApprovals"]>[number];
export interface ToLangChainOptions {
  /** Pass LangGraph's interrupt. Resume with {requestId, outcome:"allow"|"deny"}.
   * Process-local, single-use runtime tickets; use a checkpointer and thread ID. */
  nativeApproval?: {interrupt: (request: NativeApprovalRequest) => unknown};
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
        let result = await toolkit.invoke(tool.name, args, {
          signal: config?.signal, deferApproval: !!options.nativeApproval
        });
        if (options.nativeApproval && result.status === "error" && result.error.code === "approval_required") {
          const requestId = result.error.details?.approvalRequestId;
          const request = toolkit.listDeferredApprovals().find(r => r.id === requestId);
          if (request) {
            // GraphInterrupt must escape the adapter untouched. On replay,
            // interrupt returns the trusted host's resume value, not model input.
            const response = options.nativeApproval.interrupt(request) as {requestId?: unknown; outcome?: unknown} | null;
            const valid = response && typeof response.requestId === "string" &&
              (response.outcome === "allow" || response.outcome === "deny");
            const resumedId = response && typeof response.requestId === "string" ? response.requestId : request.id;
            if (resumedId !== request.id) toolkit.discardDeferredApproval(request.id);
            try {
              result = await toolkit.resumeApproval(resumedId,
                {outcome: valid ? response.outcome as "allow" | "deny" : "deny"},
                {name: tool.name, input: args, signal: config?.signal});
            } catch (error) {
              result = toFailure({name: tool.name, version: tool.version}, error);
            }
          }
        }
        if (options.returnEnvelope || result.truncation) return JSON.stringify(result);
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
        if (options.returnEnvelope || result.truncation) return JSON.stringify(result);
        throw new ToolExecutionError(tool.name, result);
      }
    }) as typeof exposed.call;
    return exposed;
  });
}
