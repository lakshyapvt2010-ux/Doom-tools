# Runtime observability and cancellation

Every supported invocation exit, including validation errors and guessed/hidden tool names, has a trace ID, timing, one terminal trace and an audit start/end pair. Schema validation and pre-cancellation happen before authorization, so their trace `policyDecision` is `not_evaluated`, not an invented allow/deny decision.

```ts
const controller = new AbortController();
const pending = toolkit.invoke("filesystem.search", { pattern: "**/*.ts" }, {
  signal: controller.signal,
  timeoutMs: 5000
});
// controller.abort(); // cancels the request and signals cooperative work
const result = await pending;
console.log(result.traceId, result.timing);
console.log(toolkit.traceRecords());
console.log(toolkit.metrics());
```

MCP request cancellation and Vercel execution `abortSignal` are forwarded. Cancellation also removes pending runtime approvals. A late allow decision cannot restart the cancelled invocation or become a remembered approval.

The execution timeout starts after approval, is capped by policy and supplies an absolute execution deadline. Approval requests have a separate expiry. A cancelled/expired invocation must be started again; resolving a no-longer-pending request returns false.

## Local metrics

`toolkit.metrics()` returns snapshot copies of aggregate rows:

- registered tool name, policy decision, status and stable error code;
- invocation count, total duration and maximum duration in milliseconds.

Derived selections share the parent's counters. Unknown tool names use one `[unknown]` label. Metrics are capped at 1,024 series, evicting the oldest-created series at capacity. These are retained local aggregates, not all-time totals after eviction. There are no inputs, outputs or trace IDs in counters and no network telemetry. Traces retain the latest 1,000 records.

Input/output payload capture in audit remains off by default. Configured redaction is applied to results and audit events, including early failures. It is best-effort, not a secret-containment guarantee. The in-memory audit stream is currently unbounded. Optional sink failures add a warning while preserving the in-memory stream; durable external delivery and fail-closed sink handling are not implemented.

## Boundaries

An abort signal stops runtime waiting and asks cooperative tools to stop. It cannot reverse side effects or forcibly stop arbitrary non-cooperative host code. Bash kills its child process group; Git passes the signal to its child process. There is no OS/container sandbox in this prototype.

If a runtime budget shortens a paginated `items` result, its provider `nextCursor` is removed rather than pointing past omitted items. Follow the truncation hint: retry the same input cursor with a smaller limit, then use the cursor returned by that complete page. UTF-8 byte truncation keeps complete code points. Model-specific output token accounting and general per-tool runtime budget overrides remain open work.
