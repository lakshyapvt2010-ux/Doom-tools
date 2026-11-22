# MCP client (`@agentic-tools/mcp-client`)

PRD FR-021 (P1). `connectMcpTools(client, { prefix })` lists the tools of an already-connected MCP SDK `Client` and returns `ToolDefinition`s for a toolkit.

Trust rules enforced here and by the runtime:

- Every remote tool is `external` / `high` risk, so it needs approval by default. With no approver the call fails with `approval_required`.
- The `mcp.call` capability must be granted explicitly (`policy.capabilities["mcp.call"] = true`). Without it every call fails with `permission_denied`.
- Remote annotations such as `readOnlyHint` are ignored for classification. Only the host can narrow a tool, through `declare`, and never beyond `external`.
- Names are namespaced `<prefix>.<name>`; invalid or duplicate names, non-object schemas and tools past `maxTools` (default 64) are skipped and reported in `skipped`.
- Remote descriptions are whitespace-normalized, capped (default 300 chars) and labeled untrusted.
- Results are returned as `{ untrusted: true, source, notice, text }`. Non-text content is replaced with an omission marker. `isError` maps to `provider_error`.
- Caller cancellation is passed to the client; a cancelled call returns `cancelled`.
- Runtime selection (`select`) and input validation against the remote schema apply as for any tool.

Limits: this package does not spawn servers or open transports. The host creates the SDK client, so host-mode stdio servers run with host privileges and `network` policy cannot constrain them. Tool lists are read once at connect time; there is no live `tools/list_changed` handling. Prompt injection in results is labeled, not prevented.

## Launching a server (`launchMcpServer`, P1)

```js
import { launchMcpServer } from "@agentic-tools/mcp-client";

// stdio: spawn a local server process (no shell; minimal default environment)
const local = await launchMcpServer(
  { transport: "stdio", command: "node", args: ["server.mjs"] },
  { prefix: "fx" }
);

// Streamable HTTP: connect to a remote endpoint, optional bearer token
const remote = await launchMcpServer(
  { transport: "http", url: "http://127.0.0.1:8787/mcp", authToken: process.env.MCP_TOKEN },
  { prefix: "up" }
);

toolkit.register(local.tools);
await local.close();
```

The trust rules do not change: every registered tool is still external/high (unless the host narrows with `declare`), still needs the `mcp.call` capability, and still goes through approval, selection and audit. Choosing which server to spawn or connect to is the host's trust decision, and this helper does not relax it. Remote names containing dots now register (previously skipped), so a toolkit can wrap another Agentic Tools MCP server: the policy-proxy composition from PRD section 20 question 2 works end to end, and is covered by a test.

Limits: stdio spawns with the SDK's minimal default environment plus any `env` you pass; stderr is piped. HTTP supports a bearer token only; TLS and certificate handling are the platform fetch defaults. No OAuth discovery, no reconnect/resume logic, no list_changed handling.
