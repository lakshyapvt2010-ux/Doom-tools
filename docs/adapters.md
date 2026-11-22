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

## Vercel AI SDK (P0 framework adapter)

```ts
import { toVercelAI } from "@agentic-tools/adapter-vercel";
const tools = toVercelAI(toolkit, { wrapSchema: jsonSchema }); // jsonSchema from "ai" v5
```

- Returns a `Record<string, tool>`-shaped map. Without `wrapSchema`, raw JSON Schema is
  exposed as `inputSchema`.
- Failures throw `ToolExecutionError` carrying the stable `code` (`validation`,
  `approval_required`, ...) and the full envelope on `.result`. `returnEnvelope: true`
  returns the envelope instead of throwing.
- The AI SDK has no standard approval primitive, so approval-gated calls surface
  `approval_required`; they are never skipped or weakened (PRD 9.5).

## Compatibility

See docs/compatibility.md for the client/version matrix and known limits.
