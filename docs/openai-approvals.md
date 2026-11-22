# Native OpenAI Agents approvals

The ordinary `toOpenAIAgents` adapter keeps runtime approval behavior. To use SDK
interruptions, create the explicit bridge instead. Tests use SDK 0.22.0 and local
ScriptedModel, not hosted models or paid calls.

```ts
import { Agent, Runner } from "@openai/agents";
import { createOpenAIAgentsApprovalBridge } from "@agentic-tools/adapter-openai-agents";

const bridge = createOpenAIAgentsApprovalBridge(toolkit, { returnEnvelope: true });
const agent = new Agent({ name: "Workspace assistant", tools: bridge.tools, model });
const runner = new Runner({ tracingDisabled: true });
let result = await runner.run(agent, input);
for (const interruption of result.interruptions) {
  if (interruption.rawItem.type !== "function_call") continue;
  const callId = interruption.rawItem.callId;
  const pending = bridge.listPending().find(p =>
    p.callId === callId && p.name === interruption.name);
  if (!pending) throw new Error("No live runtime ticket for this interruption");
  // Show pending.request through your authenticated human UI. It contains a
  // redacted preview, classification, triggering rule, hash, ID and expiry.
  // Only after that human approves this exact request:
  bridge.approve(result.state, interruption, pending.request.id);
  // For a refusal, call bridge.reject(state, interruption, requestId).
}
result = await runner.run(agent, result.state);
```

A runtime approval preview validates and classifies without running an allowed
read tool. Only gated calls interrupt. The bridge couples the SDK state decision
to a single-use runtime ticket, then the runtime rechecks exact input, version,
classification, current policy, selection and expiry at execution. Calling
`result.state.approve()` directly, including `alwaysApprove`, does not grant the
runtime approval. The bridge only approves once and does not expose an
always-approve option. An input/policy change cannot inherit a prior decision.

Host UI code must authenticate the human and keep the toolkit/bridge/checkpoint
state scoped to that host user/session. These APIs do not authenticate callers.
Use the bridge's redacted request, rather than rendering raw SDK arguments as if
they were redacted. Native rejection is handled by the SDK before tool execution;
it is not a runtime invocation, so no runtime execution trace is invented.

The bridge and runtime stores retain at most 256 live entries. Tickets expire
within five minutes and do not survive process restart. Restoring SDK state alone
is not approval persistence. An expired/restored/unknown request requires a fresh
call and human decision. No hosted approval endpoint, durable distributed queue
or SDK-version-independent compatibility is claimed. SDK-owned rejection and
validation messages are outside the runtime-result envelope cap.

Tests cover real Runner interruption/allow-resume once, denial, direct-SDK
approval rejection, exactly-once reads, expiry, changed input/policy and a forged
or mismatched ticket. No external model behavior or usability claim follows.
