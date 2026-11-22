# @agentic-tools/core

Canonical tool contract, result envelope and custom-tool SDK for Agentic Tools.
Zero runtime dependencies. TypeScript-first, Node.js >= 22, ESM only.

This package implements the PRD (v0.2) sections:

- **8.3 Canonical tool contract** — `ToolDefinition`, `SideEffect`, `Risk`,
  `capabilities`, the per-invocation `classify` hook (`InvocationClass`) and
  the scoped `ToolContext`. JSON Schema is the canonical format; Zod is an
  optional authoring convenience converted at registration (`defineZodTool`).
- **8.4 Standard result and error model** — the `ToolResult` envelope,
  stable `ErrorCode`s, `ToolError`, and the explicit `TruncationInfo` marker.
- **11 Custom tool SDK** — `defineTool`: return a plain value or throw, and
  the SDK wraps it into the envelope. Return a `ToolResult` yourself (via
  `success()` / `failure()`) when you need warnings, timing, metadata or a
  truncation marker; author-built envelopes pass through untouched.

## Deliberately out of scope here

Per the PRD's execution lifecycle (8.5), these belong to the runtime and
security packages, not the contract layer:

- input validation against the schema (FR-002)
- policy evaluation, capability grants and selection enforcement (FR-005, FR-019)
- the approval flow (FR-006)
- workspace isolation, sandboxing and secret redaction (section 9)
- timeouts, output budgets and pagination (FR-008, FR-022)
- tracing, metrics and audit (FR-010, FR-015)

## Error disclosure model

- Throw `ToolError(code, message)` for intentional, model-visible failures:
  the code and message pass through exactly as written.
- Any other thrown value becomes a generic `execution_error`, but its
  `Error.message` is forwarded **verbatim**. Keep secrets, paths and
  environment values out of thrown messages. Stack traces are never copied
  into the envelope. Best-effort secret redaction is the runtime's layer
  (PRD 9.1), not this package's.

## Example

```ts
import { defineTool } from "@agentic-tools/core";

export const searchUsers = defineTool<{ query: string }, unknown[]>({
  name: "users.search",
  description: "Search users in the application",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false
  },
  sideEffect: "read",
  capabilities: ["database.read"],
  execute: async ({ query }, ctx) => {
    // ctx.services.database is present only if the host registered it and
    // policy granted database.read (enforced by the runtime).
    return (ctx.services.database as any).users.search({ query });
  }
});
```

## Develop

```bash
pnpm install
pnpm build
pnpm test
```
