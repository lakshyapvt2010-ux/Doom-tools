# Validation status

This is a P0 prototype for review, aligned to the supplied PRD v0.2 dated November 9, 2026. It is not an alpha release or evidence of demand. The original prototype is preserved in the preceding baseline commit.

## Evidence from the November 22 improvement pass

- Build and strict TypeScript checks pass on Linux.
- The full test suite is run on Linux with Node 22.23.5, 24.22.3 and 26.13.1. See the final verification count below.
- A deterministic repository-task test creates a disposable local Git repository, reads and searches code, detects a failing test, edits the implementation, reruns the test, commits and checks a clean working tree.
- That task runs through both a connected MCP SDK client/server pair and the actual Vercel AI SDK 5.0.292 `generateText` tool-execution loop. The model is a local deterministic test double. No hosted model, API key or external repository is used.
- A connected MCP client advertising form elicitation exercises both approval acceptance and denial, with no host approver.
- Caller cancellation is checked through both adapters, including propagation to the tool signal. Pending approvals are removed on cancellation; late approvals cannot execute or become remembered grants.
- Runtime validation failures, hidden/unknown tool calls and policy/approval outcomes now pass through one terminal path for timing, redaction, traces, local metrics and audit.
- Metrics are bounded, in-memory aggregates, shared by derived toolkits. They contain no inputs, outputs or trace IDs, and send no telemetry. Unknown tool names share one metric label.
- A malformed classifier now falls back to all declared static bounds, including capabilities. Malformed approver decisions never count as explicit approval.
- Truncated paginated results no longer return a cursor that skips omitted items. UTF-8 truncation no longer cuts a code point.
- Git verifies its actual repository root is inside the workspace, rather than accidentally operating on an enclosing repository. Caller cancellation is passed to Git. Host `GIT_DIR` overrides and arbitrary inherited secret-bearing variables are not forwarded. Hooks, pagers, filesystem monitors and commit signing are disabled for tool execution; external diff/textconv commands are disabled for diff.

## Prototype gate, PRD section 18

| Bar | Status |
| --- | --- |
| Defined repository task through MCP and one framework | PASS for deterministic automated execution. Autonomous model task performance has not been evaluated. |
| Adversarial suite, FR-023 | PASS for the checked-in cases. This is not a security audit or proof of no vulnerabilities. |
| Approval flow through both adapters, including non-interactive denial | PASS in automated tests. MCP form elicitation accept/deny is exercised with a connected SDK client. Named desktop MCP clients are not certified. |
| Shared canonical tool behavior across adapters | PASS for covered validation, selection, approval, cancellation and repository-task paths. No live model provider is certified. |
| External developers succeed from a clean install without help | NOT TESTED. A local clean-install check is not a substitute for external developer evidence. |

## Section-20 product gate remains open

No competitor/overlap review or developer interviews were performed in this improvement pass. The required 5-10 primary-persona developer conversations, a dated competitive review and an evidence-backed wedge decision remain outstanding. No outreach was undertaken. The runtime-first positioning and choice of Vercel as the first framework adapter remain provisional product choices.

## Remaining requirements and limits

- Three examples ship: coding-agent wiring, a read-only repository assistant and a read-only data assistant (sqlite.query, policy grant, rejection of writes). RAG and browser examples are not implemented; their underlying tool packages are later-phase work. PRD section 17 lists these examples.
- Output shaping has a toolkit payload byte budget and tool-specific pagination/limits, not model-specific output token accounting or general per-tool runtime budget overrides. Envelope, JSON escaping and structural overhead can exceed the nominal content cap; strict final-wire byte accounting remains open. Token footprints of definitions are approximate.
- The MCP integration tests use an in-memory transport; stdio is the shipped launch transport. Streamable HTTP and outbound MCP client integration are P1 work.
- No named desktop MCP client or hosted model provider was exercised. The SDK fixture is not evidence of provider behavior or autonomous agent quality.
- Shell is trusted-host only. Cancellation and timeout stop waiting and signal cooperative tools; arbitrary host-side work can continue. There is no container/OS isolation backend.
- Git is still a host binary. Repository configuration, filter drivers, global configuration and native Git behavior are not a sandbox. Use trusted repositories only. Disabling hooks/signing is intentional and may differ from an interactive Git workflow.
- Path checks retain time-of-check/time-of-use limits on a mutable host filesystem.
- Best-effort secret redaction cannot stop transformed, encoded or split secrets. Avoid placing secrets in tool-accessible resources.
- Optional audit sinks are best-effort: a failure adds a result warning and does not erase the in-memory stream. Durable/fail-closed external audit delivery is not implemented.
- Trace retention is capped at 1,000 records and metrics at 1,024 series. The in-memory audit stream has no retention limit yet; hosts should rotate/recreate long-lived toolkits or add a managed sink.
- macOS is in CI configuration, but was not locally tested in this Linux verification pass. Check the actual workflow result before calling the cross-platform matrix green.
- Package names, licensing, publication, provenance and the release/support policy remain open product decisions. Packages remain `UNLICENSED` and were not published or deployed.

## Final verification count

Final source verification: **127 tests passed, 0 failed, 0 cancelled, 0 skipped on each of Linux Node 22.23.5, 24.22.3 and 26.13.1**. This is 26 more tests than the preserved 101-test baseline. The test package contains 22 adversarial/integration cases, including its original 16 cases.

A separate source-only verification directory passed frozen-lockfile installation, build and strict typecheck. Both checked-in examples and the CLI capability report were smoke-tested. No deployment, npm publication, hosted model call or external interview was performed. macOS workflow results are reported separately rather than inferred from local Linux runs.

## Filesystem confinement follow-up

The first CI run of the improved source passed its Linux jobs but failed on macOS because a symlink to a missing outside target was treated as an ordinary missing file. The follow-up resolves dangling symlink targets before policy checks in filesystem, runtime and Git paths, with a bounded recursion limit. Workspace and policy roots are also canonicalized so macOS-style symlink aliases use the same boundary. Two regression tests cover outside-target read/write denial and workspace-root aliases. Build, strict typecheck and all 127 tests passed locally on Linux Node 22.23.5, 24.22.3 and 26.13.1. This local result does not certify macOS; the follow-up workflow must be checked separately.

## Mock, record and replay (FR-014)

A new `@agentic-tools/testing` package adds `mockTool`, `recordTools` and `replayTools` with a versioned, validated recording format and best-effort redaction at record time. Eight tests cover mock errors, record/replay round trip without running the real tool, key-order-insensitive matching, unmatched calls failing closed, single consumption, redaction and runtime selection still applying to replayed tools. Verified locally on Linux Node 22 only so far; the full matrix and macOS CI have not yet been run for this change. See docs/testing.md for limits.

## MCP client (FR-021)

A new `@agentic-tools/mcp-client` package registers tools from an external MCP server as untrusted tools. Seven tests use a real MCP SDK server/client pair: external/high classification that ignores readOnlyHint, fail-closed denial without an explicit `mcp.call` grant, approval required by default, validation before the server is reached, labeled untrusted results, isError mapping, host narrowing that cannot exceed external, selection caps and cancellation. Linux Node 22 only so far; the connection is in-memory, with no stdio or HTTP transport and no `list_changed` handling. See docs/mcp-client.md.

## Web fetch, footprint gate and git default set

- New `@agentic-tools/web` package with `web.fetch` (GET only), policy-classified by host, deny-by-default network, approval by default, redirects returned not followed, private destinations refused, bounded text output labeled untrusted. 8 tests with a local HTTP server. Addresses are validated at connect time (custom lookup), closing the DNS rebinding gap per hop; covered by a test using a name that resolves to loopback (skipped if the resolver lacks the mapping). See docs/web.md.
- New footprint regression test (docs/footprint.md) with budgets per default tool set.
- Found and fixed a PRD conflict: the git default set contained `git.branch`, whose static upper bound is `write` (it can create branches). FR-019 and section 8.6 require read-only defaults. The default is now `git.branches` (list only); `git.branch` with create is opt-in. This renames a default tool, a small breaking change for the prototype. A test now asserts every default git and filesystem tool is statically read-only.

## SQLite read tool

New `@agentic-tools/sqlite` package with `sqlite.query` (read-only, single statement, workspace-confined file, explicit `sqlite.read` grant, capped untrusted output). 8 tests cover results, row cap, write/PRAGMA/ATTACH/multi-statement rejection with data unchanged, guard handling of literals and comments, outside-workspace and missing files, a non-database file, and denial without a grant. Uses experimental `node:sqlite`; synchronous queries cannot be interrupted. See docs/sqlite.md.

## Streamable HTTP transport for the MCP server

`serveMcpHttp` and `agentic-tools serve --http` add the P1 Streamable HTTP transport. Six tests with the real MCP SDK client cover list/call through the runtime, loopback default and refusal of an unauthenticated non-loopback bind, foreign Origin and Host rejection, bearer token enforcement, missing/unknown session, wrong path, oversize body and bad JSON rejection, and the session cap. The CLI was also smoke-tested against the coding-agent example config with an SDK client. Limits (no TLS, OAuth or rate limiting; no named desktop client) are in docs/adapters.md. The earlier note that only stdio ships is superseded.

## Competitive review (section 20, first half)

docs/competitive-review.md is a dated (November 22, 2026) source-grounded landscape review across the PRD's categories: agent SDK permission systems (Claude Agent SDK, OpenAI Agents SDK, Vercel AI SDK, LangGraph HITL), reference MCP servers, five MCP gateway/proxy projects (the closest overlap), guardrail layers (NeMo, Invariant, policy-as-code) and sandbox providers (E2B, Daytona). It answers the three review questions provisionally and records a candidate wedge statement. It is desk research only: the 5-10 developer conversations and the go/no-go decision remain undone, so the gate is NOT passed.

## Clean-install validation and remaining examples

Fresh `git clone`, `pnpm install --frozen-lockfile`, build, strict typecheck and the full suite pass from a clean checkout on Linux Node 22: 171 tests, 0 fail. Both earlier examples and the new data-assistant example run from that checkout, and the CLI (help, validate, tools list) works. Note: the pnpm store cache on this machine was warm, so dependency resolution was not exercised from an empty cache; CI does that on every push.

New example `examples/data-assistant`: seeds a SQLite file, runs a parameterized read through the policy-granted sqlite.read capability, shows a rejected DELETE and a filesystem listing. No model or API key.

## MCP client transports (stdio and Streamable HTTP)

`launchMcpServer` closes the gap where `connectMcpTools` needed an already-connected client. It spawns a stdio server process (no shell, minimal environment) or connects to a Streamable HTTP endpoint with an optional bearer token, then registers the remote tools under the same untrusted rules. 6 new tests: real stdio spawn via the repo's own adapter fixture, fail-closed policy without mcp.call, HTTP with token required/enforced, rejection of non-http URLs and unknown transports, and dotted remote names (needed to wrap another Agentic Tools server, the section-20 proxy composition). One behavior change: remote tool names containing dots now register instead of being skipped as invalid.
