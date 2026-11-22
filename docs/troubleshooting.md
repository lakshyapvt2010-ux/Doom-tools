# Troubleshooting

| Error code | Meaning | Fix |
| --- | --- | --- |
| validation | Input failed the tool's JSON Schema | Read `error.details.issues`; fix the arguments. |
| permission_denied (selection) | Tool not exposed to this toolkit/run/server | Add the operation to the package `only`, or widen the run selection. |
| permission_denied (policy) | Capability denied, e.g. path escapes the workspace | Keep paths inside `workspace`; check for symlinks; add an explicit constrained grant. |
| approval_required | Gated call, no approver available | Add `cliApprover()` / `fileQueueApprover()`; the error carries the request ID and expiry. |
| timeout | Execution exceeded its bound | Raise `policy.timeouts.defaultMs` or the tool's own timeout input. |
| cancelled | The invocation was cancelled | Check who aborted the signal. |
| resource_limit | A built-in limit was hit (e.g. diff size cap) | Use a narrower input; for repo files use `git.diff`. |
| not_found | File/directory/repo missing | Check the path relative to the workspace root. |
| conflict | Ambiguous edit target | Make `find` unique or pass `all: true`. |
| provider_error | Reserved for external provider failures (P1+ tools) | — |
| execution_error | Unknown throw from tool code | The message is forwarded verbatim; fix the tool or catch and rethrow `ToolError`. |

## Diagnostics

- `agentic-tools doctor` — platform capabilities and honest trust-mode guarantees.
- `agentic-tools validate` — config errors plus warnings (e.g. network policy vs host shell).
- `toolkit.auditEvents()` / `toolkit.traceRecords()` — correlated history by trace ID.
