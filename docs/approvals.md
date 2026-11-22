# Approval flow

Approvals are a runtime feature, not an adapter feature (PRD 9.5, FR-006).

## Model

- An **approval request** is a runtime object: ID, tool, classified invocation, the policy
  rule that triggered it, a redacted input preview and an expiry (default 5 minutes).
- A **decision is bound to the exact classified input** (SHA-256 over tool, input and
  classification). Approving `rm -rf a` never approves `rm -rf b`.
- Rules come from `policy.approvals`, checked as: exact tool name, then each requested
  capability, then `sideEffect:<kind>`, then the default (destructive/external require
  approval; read/write do not). Values: `"always"` (every call), `"ask"` (may be remembered
  when `policy.allowRememberedApprovals` is true), `"never"` (explicit relaxation).
- **Remembered decisions are bounded.** They expire after `policy.rememberedApprovals.ttlMs`
  (default 1 hour), the store evicts the oldest entries beyond `maxEntries` (default 256),
  and `toolkit.revokeRememberedApprovals()` invalidates them all (e.g. on policy reload).
- With no approver available the call fails with `approval_required` and carries the
  request ID. It is never auto-approved.

## Approvers (tried in order)

| Approver | Import | Use |
| --- | --- | --- |
| callback | `callbackApprover(fn)` | In-process host decides. |
| CLI prompt | `cliApprover()` | Interactive terminal (`y`/`a`/`n`). Returns null when not a TTY. Marked `usesStdio`: it is disabled while serving MCP over stdio (the transport owns those streams) and never counts as an out-of-band path for tool exposure. |
| file queue | `fileQueueApprover({ dir })` | Non-interactive/remote: requests land in `<dir>/pending`, an operator resolves with `agentic-tools approvals approve|deny <id> --queue <dir>`. Polls until decision or expiry. Decisions MUST carry the request's `inputHash`; a decision without it (or bound to a different input) is denied, never honored. |
| MCP elicitation | automatic in `adapter-mcp` | Asks the MCP client user when the client supports elicitation; tried before toolkit approvers. |

## Non-interactive agents

Configure `fileQueueApprover` (or a callback that records and defers). Gated calls wait for
a real decision until expiry, then fail with `approval_required`. Out-of-band decisions can
also be injected in-process with `toolkit.resolveApproval(requestId, decision)` while the
request is pending.

## Adapter behavior

No adapter may skip or weaken approval (PRD 10.2). The MCP server hides approval-gated
tools from clients that cannot present approvals unless an out-of-band approver exists
(approvers marked `usesStdio`, such as the CLI prompt, do not count: they cannot present
while the transport owns stdio); the Vercel adapter surfaces `approval_required` as a
`ToolExecutionError` with the stable code and the resumable request ID.
