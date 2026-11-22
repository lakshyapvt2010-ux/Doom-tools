# Tool selection and context footprint (PRD 8.6, FR-019)

Installing a package never exposes all of its operations. Selection happens at four levels
and is enforced by the runtime at invocation time; hiding a schema is never the only
control.

1. **Package level** — install only the packages you need.
2. **Operation level** — package factories take `only`/`except`. Defaults are minimal and
   read-only (`filesystem`: read, list, search, grep, diff; `git`: status, diff, log,
   branch). Write, external and destructive operations are never in a default set.
3. **Run level** — `toolkit.select({ name, tag, sideEffect, risk, capability })` returns a
   derived toolkit that shares the parent's runtime, policy and audit stream and can only
   narrow.
4. **Server level** — `serveMcp(toolkit)` exposes only the toolkit's selected set, and
   hides approval-gated tools from clients that cannot present approvals (unless an
   out-of-band approver is configured).

Calls to anything outside the active selection fail with `permission_denied` in every
adapter, including names the model guessed or hallucinated.

## Context footprint

`toolkit.describeFootprint()` and `agentic-tools tools list --tokens` report the
approximate token cost (4 chars/token estimate) of the exposed definitions, so you can see
what a selection costs before handing it to a model.
