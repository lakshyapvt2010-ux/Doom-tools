# Native LangGraph approvals

The LangChain adapter can map a runtime approval request to LangGraph's native
interrupt and checkpoint/resume flow. It remains opt-in. Inject the released
LangGraph `interrupt` function; the adapter does not add a production dependency
on LangGraph or run a hosted model.

```ts
import { interrupt, Command } from "@langchain/langgraph";
import { toLangChain } from "@agentic-tools/adapter-langchain";

const tools = toLangChain(toolkit, {
  nativeApproval: { interrupt },
  returnEnvelope: true
});
// Add these tools to a ToolNode in a graph with a checkpointer.
// Use a distinct configurable.thread_id for each conversation.
const paused = await graph.invoke(input, config);
// Present paused.__interrupt__[0].value to your authenticated human UI.
// It is a runtime request: ID, tool/version, classified invocation,
// redacted input preview, hash, triggering rule and expiry.
const request = paused.__interrupt__[0].value;
// Only after the human approves this exact request:
const resumed = await graph.invoke(new Command({
  resume: { requestId: request.id, outcome: "allow" }
}), config);
// Use outcome:"deny" for a refusal. Never let the model construct this value.
```

The graph interrupts before execution. On replay, the adapter discards its
speculative new ticket and resumes the original runtime ticket. Runtime checks
include exact tool/input/classification, policy, selection, expiry and one-time
use. A malformed response denies; an unknown/expired ID cannot execute. Runtime
rejections keep stable codes. Without `returnEnvelope`, failures throw the
adapter's `ToolExecutionError`. GraphInterrupt is not converted into a tool error.

Scope toolkit and checkpoint access to the authenticated host user/session.
Neither runtime tickets nor the graph authenticate the human for you. Tickets
are process-local, expire after five minutes and have a 256-entry store. Keeping
a LangGraph checkpoint alone does not persist the runtime ticket across process
restart. Restart or expiry requires a new request and decision. A host cancelling
an interrupted graph should discard its deferred ticket explicitly; otherwise
it expires. No OS/process sandbox, remote webhook service or durable distributed
approval backend is provided.

Tests use actual LangGraph 1.7.5 StateGraph, ToolNode, MemorySaver, interrupt and
Command, not a mock interruption: allow/resume once, deny/malformed response,
expiry and unknown ID. No hosted model, account or network write is involved.
