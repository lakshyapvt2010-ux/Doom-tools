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
