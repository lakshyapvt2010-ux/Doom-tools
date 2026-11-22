# Authoring custom tools (PRD 11, FR-013)

```ts
import { defineTool, ToolError } from "@agentic-tools/core";

export const searchUsers = defineTool({
  name: "app.search_users",
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
    return ctx.services.database.users.search({ query });
  }
});
```

- Return a plain value; it is wrapped in a success envelope. Throw to fail; unknown errors
  become `execution_error` with a generic message, not the arbitrary exception text,
  stack or cause. `ToolError` is the intentional disclosure path: supply a safe code and
  message, never raw provider diagnostics or secret values.
- Return `success(...)`/`failure(...)` envelopes yourself when you need warnings, timing,
  metadata or an explicit truncation marker.
- `ctx.services` contains only host-registered services your tool declared a capability
  for AND policy granted; anything else throws `permission_denied`.
- Argument-dependent risk? Add `classify(input)`: it may narrow, never widen, the declared
  side effect/risk/capabilities. The classification is untrusted data: the runtime fails
  closed to the static bounds when classify throws OR returns out-of-enum values
  (a `sideEffect`/`risk` it does not recognize, capabilities the tool never declared).
- Honor `ctx.signal` and finish before `ctx.deadline`. The runtime enforces the deadline
  on its side and will report `timeout` even if your tool never settles, but it cannot
  forcibly stop host-side work your tool already started - the error says so.
- Zod authoring is supported via `defineZodTool` with a caller-supplied converter
  (open decision 21.4); JSON Schema is always the wire format.

Register by including the definition in `createToolkit({ tools: [...] })`. Validation,
policy, approvals, tracing, budgets and audit apply automatically (PRD 11).

## Testing

Invoke through a toolkit in a temp workspace; or call `definition.execute(input, ctx)`
directly with a stub `ToolContext` for pure unit tests (see `packages/*/test/*.test.ts`).

Inline literal JSON Schemas infer input types in `defineTool` without a manual
input generic. Required and optional object fields, nested objects, arrays,
primitive types, nullable type arrays, enum/const and anyOf/oneOf unions are
covered. Widened schemas, references and unsupported inference constructs remain
unknown rather than pretending to infer them. Runtime JSON Schema validation is
still required; TypeScript types are not an authorization or validation boundary.
Explicit input/output generics remain supported. Exported `SchemaInput<S>` can
also be used in host code.
