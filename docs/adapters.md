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
- Request cancellation reaches pending approvals and cooperative tools. Stdio-prompting
  approvers are excluded, including after another approver cannot decide.

## Vercel AI SDK (P0 framework adapter)

```ts
import { jsonSchema } from "ai";
import { toVercelAI } from "@agentic-tools/adapter-vercel";
const tools = toVercelAI(toolkit, {
  wrapSchema: jsonSchema,
  nameForTool: name => name.replaceAll(".", "_")
});
```

- Returns a `Record<string, tool>`-shaped map. Without `wrapSchema`, raw JSON Schema is
  exposed as `inputSchema`.
- Failures throw `ToolExecutionError` carrying the stable `code` (`validation`,
  `approval_required`, ...) and the full envelope on `.result`. `returnEnvelope: true`
  returns the envelope instead of throwing.
- The AI SDK has no standard approval primitive, so approval-gated calls surface
  `approval_required`; they are never skipped or weakened (PRD 9.5).
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
