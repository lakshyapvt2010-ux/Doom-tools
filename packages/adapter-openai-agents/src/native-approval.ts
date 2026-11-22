/** Native SDK interruptions coupled to single-use runtime approval tickets. */
import type { FunctionTool, RunToolApprovalItem } from "@openai/agents";
import { ToolError, toFailure } from "@agentic-tools/core";
import type { Toolkit } from "@agentic-tools/runtime";
import type {ToOpenAIAgentsOptions} from "./index.js";
import {buildTools} from "./factory.js";
type Request = ReturnType<Toolkit["listDeferredApprovals"]>[number];
type State = {approve(item: RunToolApprovalItem): void; reject(item: RunToolApprovalItem): void};
interface Pending {request: Request; callId: string; name: string; approved: boolean}
export interface OpenAIAgentsApprovalBridge {
  tools: FunctionTool<any, any, any>[];
  listPending(): {request: Request; callId: string; name: string}[];
  /** Host must obtain the human decision before calling this method. */
  approve(state: State, interruption: RunToolApprovalItem, requestId: string): void;
  reject(state: State, interruption: RunToolApprovalItem, requestId: string): void;
}
export function createOpenAIAgentsApprovalBridge(toolkit: Toolkit, options: ToOpenAIAgentsOptions = {}): OpenAIAgentsApprovalBridge {
  const pending = new Map<string, Pending>();
  const byCall = new Map<string, string>();
  const key = (name: string, id: string) => JSON.stringify([name, id]);
  const remove = (entry: Pending) => {
    pending.delete(entry.request.id);
    const callKey = key(entry.request.tool.name, entry.callId);
    if (byCall.get(callKey) === entry.request.id) byCall.delete(callKey);
    toolkit.discardDeferredApproval(entry.request.id);
  };
  const prune = () => {
    const live = new Set(toolkit.listDeferredApprovals().map(r => r.id));
    for (const entry of pending.values()) if (!live.has(entry.request.id)) remove(entry);
  };
  const match = (item: RunToolApprovalItem, id: string): Pending => {
    prune();
    const entry = pending.get(id);
    if (!entry || item.rawItem.type !== "function_call" || item.rawItem.callId !== entry.callId || item.name !== entry.name) {
      throw new ToolError("approval_required", "Native interruption does not match a live runtime approval ticket.");
    }
    return entry;
  };
  const tools = buildTools(toolkit, options, {
    async needsApproval(name, publicName, args, callId) {
      if (!callId) throw new ToolError("validation", "Native approvals require a tool call ID.");
      prune();
      const request = toolkit.prepareApproval(name, args);
      const existingId = byCall.get(key(name, callId));
      const existing = existingId ? pending.get(existingId) : undefined;
      if (!request) { if (existing) remove(existing); return false; }
      if (existing && existing.request.inputHash === request.inputHash && existing.request.rule === request.rule) {
        toolkit.discardDeferredApproval(request.id);
        return true;
      }
      if (existing) remove(existing);
      while (pending.size >= 256) remove(pending.values().next().value!);
      const entry = {request, callId, name: publicName, approved: false};
      pending.set(request.id, entry); byCall.set(key(name, callId), request.id);
      return true;
    },
    async invoke(name, args, _context, details) {
      prune();
      const id = details?.toolCall?.callId;
      const requestId = id ? byCall.get(key(name, id)) : undefined;
      const entry = requestId ? pending.get(requestId) : undefined;
      if (!entry) return toolkit.invoke(name, args, {signal: details?.signal});
      if (!entry.approved) {
        remove(entry);
        // Direct SDK approval alone is not a runtime authority grant.
        return toolkit.select({name: []}).invoke(name, args, {signal: details?.signal});
      }
      try {
        return await toolkit.resumeApproval(entry.request.id, {outcome: "allow"}, {name, input: args, signal: details?.signal});
      } catch (error) {
        return toFailure(entry.request.tool, error);
      } finally { remove(entry); }
    }
  });
  return {
    tools,
    listPending() { prune(); return [...pending.values()].filter(e => !e.approved).map(({request, callId, name}) => ({request, callId, name})); },
    approve(state, interruption, requestId) {
      const entry = match(interruption, requestId);
      state.approve(interruption);
      entry.approved = true;
    },
    reject(state, interruption, requestId) {
      const entry = match(interruption, requestId);
      state.reject(interruption);
      remove(entry);
    }
  };
}
