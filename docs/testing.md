# Mocking, recording and replay (`@agentic-tools/testing`)

PRD FR-014 (P1). These helpers wrap tool definitions, so metadata, `classify`, selection, policy, approvals and audit still run in the runtime. Only the final execute step is replaced.

- `mockTool(definition, handler)` returns `{ tool, calls }`. The handler returns a plain value or throws a `ToolError`.
- `recordTools(tools, { redact })` wraps tools and records each execution. Pass a redactor: recordings are files and can outlive the secrets they saw. Redaction is best-effort.
- `serializeRecording` / `parseRecording` write and validate a versioned JSON recording.
- `replayTools(tools, recording)` returns recorded results. Matching uses tool name, version and canonical input (object key order does not matter). Repeated identical calls replay in recorded order and each recording is consumed once. An unmatched call fails with `not_found` and never reaches the real tool. `unconsumed()` lists recorded calls that never happened.

Limits: only tool executions are recorded, not model output. Streaming and partial results are not captured. A redacted input will not match a live input that contained the secret. Replay is deterministic for pure tool results; time, ordering and external state are not modeled.
