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

Boundaries: these are successful-payload caps, not final transport-wire or full
envelope caps. Error messages/details, tool identity, timing, trace IDs,
truncation markers, warnings, and adapter formatting are outside this cap.
In-memory tool/provider output is materialized before shaping. These limits do
not prevent a tool or provider from allocating excessive memory upstream, and
do not replace tool-specific pagination or response bounds. Strict final-wire
budgeting remains unimplemented and must not be claimed as solved.
