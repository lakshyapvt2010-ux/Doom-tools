# Adapters (PRD 10)

Adapters translate schemas, call arguments and errors. They never reimplement tool behavior
and cannot bypass validation, policy, approvals, redaction or audit (PRD 10.2).

## MCP server (primary, P0)

```ts
import { serveMcp } from "@agentic-tools/adapter-mcp";
await serveMcp(toolkit, { transport: "stdio", name: "my-tools" });
```

- Only the toolkit's selected tools are exposed (server-level selection, FR-019).
- Clients differ in human-in-the-loop support (PRD 10.3): tools whose policy class needs
  approval are NOT listed for a client without elicitation support unless the toolkit has
  an out-of-band approver; calls to non-exposed names get `permission_denied`.
- When the client supports elicitation, approval asks happen through the client first,
  then fall back to toolkit approvers.
- Results arrive as `structuredContent` (the canonical envelope) plus a text rendering;
  failures carry `isError: true` with the stable error code intact.
- Hidden/unknown calls also pass through the runtime for trace/audit/metrics coverage.
- Result caps count both text and structured copies, escaping and CallToolResult
  wrappers before terminal audit. JSON-RPC/HTTP headers and SDK-generated errors
  are outside that cap. Impossible envelope configurations reject before execution.
- Request cancellation reaches pending approvals and cooperative tools. Stdio-prompting
  approvers are excluded, including after another approver cannot decide.

## Vercel AI SDK (P0 framework adapter)

```ts
import { jsonSchema } from "ai";
import { toVercelAI } from "@agentic-tools/adapter-vercel";
const tools = toVercelAI(toolkit, {
  wrapSchema: schema => jsonSchema(schema as Parameters<typeof jsonSchema>[0]),
  nameForTool: name => name.replaceAll(".", "_")
});
```

- Returns a `Record<string, tool>`-shaped map. Without `wrapSchema`, raw JSON Schema is
  exposed as `inputSchema`.
- Failures throw `ToolExecutionError` carrying the stable `code` (`validation`,
  `approval_required`, ...) and the full envelope on `.result`. `returnEnvelope: true`
  returns the envelope instead of throwing.
- The tested AI SDK v5 adapter does not use a native approval primitive.
  Approval-gated calls surface `approval_required` with a real, expiring deferred
  runtime ticket. A trusted host can use `toolkit.resumeApproval` with the exact
  tool/input after its human decision. Approval is never skipped (PRD 9.5).
- The SDK execution `abortSignal` reaches the runtime and cooperative tool.
- `nameForTool` maps canonical names to provider-specific naming rules. Collisions
  fail before exposure; runtime policy and trace identity still use the canonical name.
- Integration tests use actual `ai` 5.0.292 execution with a local deterministic mock
  model. Hosted provider behavior and autonomous model performance remain untested.

## Compatibility

See docs/compatibility.md for the client/version matrix and known limits.

## Streamable HTTP (`serveMcpHttp`)

```js
import { serveMcpHttp } from "@agentic-tools/adapter-mcp";
const handle = await serveMcpHttp(toolkit, { port: 8787 }); // http://127.0.0.1:8787/mcp
await handle.close();
```

CLI: `agentic-tools serve --http [--host H] [--port N]`. Set the bearer token in `AGENTIC_TOOLS_MCP_TOKEN` (never a flag, so it stays out of process listings).

- Binds to loopback by default. A non-loopback `host` is refused unless `authToken` (16+ characters) is set.
- Host and Origin headers must be loopback or explicitly allowed (`allowedHosts`, `allowedOrigins`), which blocks DNS-rebinding from a browser page.
- Each session gets its own MCP server, so one client's elicitation support never applies to another. Sessions are capped (default 32); bodies are capped (default 1 MiB).
- Tool exposure, policy, approvals, audit and redaction are the same runtime paths as stdio. A tool that needs approval is hidden unless the client supports elicitation or an out-of-band approver exists.

Limits: no TLS (use a reverse proxy for remote access), no OAuth, one shared bearer token, no rate limiting, in-memory sessions. Tested with the real MCP SDK client; no named desktop client or hosted model was exercised.

## LangChain (P1)

```ts
import { toLangChain } from "@agentic-tools/adapter-langchain";
const tools = toLangChain(toolkit, {
  nameForTool: name => name.replaceAll(".", "_")
});
```

Returns real `DynamicStructuredTool` objects from `@langchain/core` 1.5.0.
Canonical JSON Schema is retained. All executions invoke the runtime; output is
JSON text. Runtime failures throw `ToolExecutionError` with `.code` and `.result`;
`returnEnvelope: true` returns the serialized envelope. LangChain validates JSON
Schema before invoking the callback. Its parsing failures are normalized to a
safe `validation` envelope without running the callback. Such framework-level
rejections do not enter runtime audit; executed calls do. Cancellation config is forwarded. Selection and name collisions are
checked. LangGraph 1.7.5 ToolNode integration is tested for successful calls and
fail-closed approval errors, with handleToolErrors:false. No hosted model or
full model-driven LangGraph loop has been tested. Opt-in
`nativeApproval: { interrupt }` maps to real LangGraph checkpoint interruption
and single-use runtime resume tickets. See [langgraph-approvals.md](langgraph-approvals.md)
for host UI, expiry, process-local storage and replay limits.

## OpenAI Agents SDK (P1)

```ts
import { toOpenAIAgents } from "@agentic-tools/adapter-openai-agents";
const tools = toOpenAIAgents(toolkit);
```

Returns real SDK function tools, tested with `@openai/agents` 0.22.0, including
construction of an `Agent` and local invocation without an API key. Dots map to
underscores by default; invalid names and collisions fail before exposure.
Object JSON Schema is passed unchanged with `strict: false` so optional fields
stay optional. Runtime validation remains mandatory. Outputs are JSON text.
`errorFunction: null` prevents the SDK replacing runtime failures with a generic
fallback. `ToolExecutionError` preserves codes and envelopes; `returnEnvelope`
returns envelopes instead. Caller signals are forwarded.

Native SDK approval never replaces runtime approval. The explicit
`createOpenAIAgentsApprovalBridge` helper couples a host-approved SDK interruption
to a single-use runtime ticket. Raw SDK approve/alwaysApprove does not grant
runtime permission. See [openai-approvals.md](openai-approvals.md) for expiry,
restoration and authenticated-host requirements. Malformed JSON may fail in the
SDK before runtime invocation. A real SDK Runner loop with local ScriptedModel
and real interruption/resume is tested, with tracing disabled. Hosted providers and model performance remain unverified. Only the tested SDK minor ranges are declared as peers for both new
adapters. Other versions require validation before expanding compatibility.


For all framework adapters, truncated successful payloads return their envelope
even in default output-only mode, so model-facing truncation markers are not
lost. Ordinary complete successes keep the earlier output-only shape. Native
framework rejections and prevalidation are outside a runtime invocation; no
runtime execution trace is invented for them. See [output-budgets.md](output-budgets.md).
