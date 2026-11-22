# Output budgets

PRD section 8.4 and FR-022. Successful output payloads can be capped per toolkit
and per canonical tool name. Selection shares the same policy and cannot widen it.

```ts
const toolkit = createToolkit({
  workspace,
  tools,
  policy: {
    budgets: {
      maxOutputBytes: 32768,
      maxOutputTokens: 4000,
      maxResultBytes: 65536,
      maxResultTokens: 8000,
      perTool: {
        "filesystem.read": { maxOutputBytes: 8192, maxOutputTokens: 1000 }
      }
    }
  },
  runtime: {
    countOutputTokens: text => myTokenizer.encode(text).length
  }
});
```

The byte cap defaults to 32768. Token caps are optional. Without a host counter,
token counting uses the existing rough estimate (four characters per token), not
an exact model tokenizer. Install/configure a model-appropriate tokenizer in host
code when an actual model context limit matters. The counter is synchronous,
pure host code; it must return a non-negative safe integer or execution fails
safely. No tokenizer package, provider account or default model is selected.
Budget values must be positive safe integers. Per-tool caps are combined with
toolkit caps by taking the smaller value, never widening a toolkit limit.

Byte and token measurement is against `JSON.stringify(output)`, including JSON
escaping and payload structural overhead. Strings preserve full Unicode code
points. Arrays retain a prefix. Pages with `items` retain a prefix and lose their
old nextCursor, since it could skip omitted items. Generic objects fall back to
a labeled `truncatedJsonPreview`. The envelope carries explicit truncation and
continuation instructions. If even a minimal shaped payload cannot fit, the
call returns `resource_limit` instead of an oversize successful preview.

Compatibility correction: a 1000-byte string payload budget now permits 998
ASCII characters, since the JSON quotes also consume two bytes. Previously the
quotes, escape expansion and preview structure were not counted. Binary search
always verifies the chosen candidate; a non-monotonic host tokenizer may produce
a smaller prefix than the longest possible one, but never an over-budget one.

## Complete runtime envelopes

`maxResultBytes` defaults to 65536 and measures the entire compact
`JSON.stringify(result)`, for success and failure. `maxResultTokens` is optional
and uses the same counter. Both also support per-tool narrowing. These are
separate from `maxOutputBytes`/`maxOutputTokens`, which retain their payload-only
meaning for compatibility.

If the complete result cannot fit, the runtime suppresses the result body and
optional fields, returning a small failure with an explicit truncation marker
and retry instructions. Existing error codes are preserved; an oversized
successful result becomes `resource_limit`, not an unmarked partial success.
This is suppression, not a summary or a promise that omitted content can be
retrieved without re-executing the tool. Do not retry mutating calls blindly.

Required tool identity and correlation fields are never silently shortened. A
budget that cannot fit a minimal failure envelope is rejected with a
`ToolError(resource_limit)` before tool execution or approval. Such a rejected
configuration produces no invocation trace/audit pair. An unusually long
caller-supplied trace ID or tool name can make an otherwise usable cap
impossible. Host token counters must be pure; arbitrary non-monotonic counters
may also reject a result after execution when no safe fallback fits. No
oversized result is emitted in that case.

The runtime reserves space for a late audit-sink warning before recording the
terminal outcome. This may suppress a result that would fit without the
warning. Both the reserved and actual rendering are checked for token caps.

Boundaries: the whole-envelope cap counts compact runtime JSON, not SDK/provider
messages, MCP's duplicated text/structured content, JSON-RPC headers, network
framing or SDK-generated validation failures. Strict final-wire budgeting is
still open. In-memory tool/provider output is materialized before shaping; these
limits do not prevent excessive upstream allocation and do not replace
tool-specific pagination or response bounds.

Framework default rendering now switches to the full envelope when the runtime
truncates a successful payload. LangChain, OpenAI Agents and Vercel adapters must
not discard the marker while returning a bare shortened payload. Complete,
untruncated successes keep their earlier output-only shape. MCP text rendering
uses compact JSON; its separate structured copy still adds protocol overhead.
