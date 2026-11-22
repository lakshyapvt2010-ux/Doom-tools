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

The dated desk competitive review is now in docs/competitive-review.md. The required 5-10 primary-persona developer conversations and an evidence-backed wedge decision remain outstanding. No outreach was undertaken. The runtime-first positioning and choice of Vercel as the first framework adapter remain provisional product choices.

## Remaining requirements and limits

- Five examples ship: coding-agent wiring, read-only repository assistant, read-only data assistant (sqlite.query), a local no-provider RAG example (custom keyword-retrieval tool + filesystem.read; lexical, no embeddings) and a headless browser agent example over a bundled loopback page. PRD section 17 lists these examples.
- Output shaping now has toolkit/per-tool successful-payload byte and optional token budgets. JSON escaping and payload structure count against the cap. Host tokenizers are supported; the default estimator is approximate. Full envelope, errors and adapter formatting remain outside the cap; strict final-wire budgeting stays open. See docs/output-budgets.md.
- MCP server transports include stdio and Streamable HTTP; outbound MCP client tests cover both. The transport changes after 4e3ac25 await the next CI run.
- No named desktop MCP client or hosted model provider was exercised. The SDK fixture is not evidence of provider behavior or autonomous agent quality.
- Shell is trusted-host only. Cancellation and timeout stop waiting and signal cooperative tools; arbitrary host-side work can continue. There is no container/OS isolation backend.
- Git is still a host binary. Repository configuration, filter drivers, global configuration and native Git behavior are not a sandbox. Use trusted repositories only. Disabling hooks/signing is intentional and may differ from an interactive Git workflow.
- Path checks retain time-of-check/time-of-use limits on a mutable host filesystem.
- Best-effort secret redaction cannot stop transformed, encoded or split secrets. Avoid placing secrets in tool-accessible resources.
- Optional audit sinks are best-effort: a failure adds a result warning and does not erase the in-memory stream. Durable/fail-closed external audit delivery is not implemented.
- Trace retention is capped at 1,000 records, metrics at 1,024 series and the in-memory audit stream at 10,000 events (oldest dropped, count exposed on the sink). Hosts needing a full record add a durable sink.
- macOS is in CI configuration, but was not locally tested in this Linux verification pass. Check the actual workflow result before calling the cross-platform matrix green.
- Package names, licensing, publication, provenance and the release/support policy remain open product decisions. Packages remain `UNLICENSED` and were not published or deployed.

## Earlier verification count (historical checkpoint)

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

## Browser tools (P2)

New `@agentic-tools/browser` package: navigate, dom, click, type, screenshot over a zero-dependency CDP driver for system Chrome headless. Every call needs an explicit `browser.control` grant; only http(s); private destinations refused by default; bounded untrusted output; 4 tests against a real headless Chrome and a local fixture page cover the full flow, fail-closed policy, scheme rejection and private-address refusal. Network enforcement was then hardened: every request (redirects, subresources, XHR, click-driven navigation) is paused through CDP Fetch interception and validated with a fresh DNS lookup before release, and failing requests are blocked (2 more tests: redirect chain plus three subresource types, blocked dead redirect). Synthetic (not trusted-pipeline) input events, one shared tab, and a residual DNS-rebinding window between the per-request lookup and Chrome's connect remain documented. See docs/browser.md. Requires a Chrome binary, present on the GitHub ubuntu/macos runners.

## Audit retention bound

The in-memory audit sink is now bounded at 10,000 events (oldest dropped, `dropped` counter exposed), closing the unbounded-retention limit noted above. 2 tests. Durable sinks are unchanged.

## RAG and browser examples

`examples/rag-agent` shows retrieval without providers: a custom `docs.retrieve` tool (defineTool, read-only, capability-gated) ranks workspace markdown by keyword overlap and filesystem.read fetches the winner. Lexical only; an embeddings provider is a later host decision. `examples/browser-agent` drives the browser package against a bundled loopback page with allowPrivateNetwork scoped to the demo. Both run offline with no model or API key and were executed in this pass.

## PostgreSQL read tool

New `@agentic-tools/postgres` package with `postgres.query`: one read-only SELECT/WITH/VALUES against a host-configured PostgreSQL (connection string or discrete settings; credentials never enter tool input). Enforcement is layered: the shared SQL guard, a session opened with `default_transaction_read_only=on`, statement_timeout, row and cell caps, untrusted output, and the explicit `database.read` grant. 3 tests run against a real throwaway PostgreSQL 16 cluster (initdb/pg_ctl): parameterized reads with untrusted/capped output, rejection of DELETE/multi-statement/PRAGMA-class input with data unchanged, and fail-closed denial without the grant. The suite skips with a reason when server binaries are absent (`AGENTIC_PG_BIN` overrides the search path); GitHub ubuntu runners ship them. Locally validated against standalone PostgreSQL 16.16 binaries on Linux Node 22. Read scope is the configured role's, so a least-privilege role is the host's job. See docs/postgres.md.

## Pluggable search and additional framework adapters

`web.search` adds a host-owned provider interface with no selected default backend
or API key. Six new tests cover host policy/approval, caps, shaping, malformed
output and provider errors. Callbacks are trusted host code, not egress-confined;
`web.fetch` DNS/private-network checks do not automatically apply to them.

LangChain core 1.5.0: eight tests through real DynamicStructuredTool invocations,
covering success, runtime errors, approval, envelope mode, selection, names and
cancellation. Framework input parsing failures are normalized to validation envelopes
without executing the callback; they do not enter runtime audit. LangGraph 1.7.5 ToolNode executes success and approval rejection; no hosted model was exercised.

OpenAI Agents 0.22.0: seven tests through real SDK function tools, including Agent
construction, optional input preservation, validation, approval, envelopes,
selection, name collisions and cancellation. A real SDK Runner loop uses the local ScriptedModel with tracing disabled. No hosted model was
exercised. Both adapter packages declare only tested minor peer ranges.

PostgreSQL follow-up corrects the earlier test's misleading read-only comment:
pg_backend_pid did not exercise write rejection. Now a stored function actually
attempts INSERT and is rejected by the server. Each query uses BEGIN READ ONLY;
a transaction-mode downgrade and actual row cap are tested. Connection abort
cleanup improved. Read-only SQL is not containment for privileged functions;
least-privilege role and function restrictions remain host responsibilities.

## Configurable HTTP client audit gap

The final P1 audit found that GET-only web.fetch did not satisfy the separate
configurable HTTP-client requirement. Opt-in web.request now supports bounded
UTF-8 bodies, safe-header restrictions and GET/HEAD/POST/PUT/PATCH/DELETE/OPTIONS.
Every call is external/high-risk and policy/approval-gated; defaults unchanged.
It shares fetch's connect-time DNS checks, response caps and redirect refusal.
Five tests use a local server; no external mutations or credentials. No built-in
authentication, proxy, cookies, multipart or binary-response support. Secrets in
custom payloads are the host's responsibility, not a claimed scanner guarantee.

## Per-tool/token output budgets and serialized-payload accounting

PRD section 8.4: optional toolkit/per-tool token caps and per-tool byte caps now
narrow the toolkit policy. Host tokenizers are supported, with the existing
four-character estimate as the explicitly approximate fallback. JSON-serialized
successful payloads count escape expansion and structural overhead; prefixes
are verified after shaping. Tiny impossible budgets return resource_limit.
Five new tests cover escaping/preview overhead, host token counting, impossible
budgets, per-tool narrowing through selection, and invalid configuration. Two
older assertions changed to reflect JSON quote overhead rather than raw text.
Full envelope/errors/warnings/adapter wire overhead remain outside payload caps;
strict final-wire budgeting is still open. See docs/output-budgets.md.
