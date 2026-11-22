# PRD v0.2 alignment: November 22 improvement pass

Source: the product owner's supplied PRD v0.2, prepared November 9, 2026. The appendix is a roadmap, not a request to build every listed integration. This pass prioritizes the coding/repository-agent persona and the policy-aware runtime.

| PRD reference | Change | Verification |
| --- | --- | --- |
| Principle 6; section 8.5; FR-010/015 | One terminal path records timing, redaction, trace, local metrics and audit, including early validation/selection failures | Runtime observability regression tests; hidden MCP calls use runtime denial |
| Sections 8.5 and 16, metrics | Bounded in-memory aggregate counters, shared by narrowed toolkits; unknown names share one label | Counter totals, snapshot isolation, retention-cap and unknown-cardinality tests |
| FR-004/008; section 10.2 | Caller cancellation reaches runtime, MCP, framework execution and Git | Adapter cancellation tests, pending-approval cleanup test, pre-aborted Git test |
| FR-006; section 9.5 | Cancelled/expired approval requests settle once and clean up listeners/timers; late decisions do not restart or become remembered | Runtime approval cancellation test and existing approval tests |
| FR-020 | Any malformed classification shape falls back to all static bounds, including capabilities | Malformed-capabilities and invalid-enum regressions |
| FR-007 and workspace principle | Git validates the actual repository root, not just the requested subdirectory; inherited Git redirection variables are removed | Enclosing-repository commit-denial and `GIT_DIR` regression tests |
| Sections 9.1 and 16 | Common Git program hooks are disabled; diff does not run external diff/textconv commands; failures to start Git are not reported as success | Hook-suppression test and Git integration suite; Git is still trusted-host software |
| FR-022 | UTF-8 truncation preserves complete characters; shortened pages do not expose a cursor beyond omitted entries | UTF-8 and pagination regression tests |
| FR-011/012 and section-18 prototype task | Defined read/search/edit/test/commit task through MCP and the real Vercel SDK execution loop | `packages/adversarial/test/repository-task.test.ts`; local deterministic mock model, no hosted provider |
| Sections 9.5 and 10.3 | Real connected MCP client exercises form elicitation accept/deny | MCP SDK elicitation integration test |
| Sections 10.1/10.2 | Pinned SDK test dependency and optional provider-name mapping, with collision rejection | `ai` 5.0.292 tests and name-mapping regression |
| FR-018 and section 16 | Current maintained Node LTS matrix, Node-major diagnostics, read-only CI token permissions | Linux Node 22/24/26 test runs; macOS remains subject to actual CI result |
| FR-014 | Mock, record and deterministic replay of tool interactions; replay cannot reach the real tool | `packages/testing/test/testing.test.ts` (8 tests) |
| FR-021; section 10.3 | External MCP tools registered as untrusted, approval-gated, capability-gated tools | `packages/mcp-client/test/mcp-client.test.ts` (7 tests) |
| Section 13 row 5; sections 9.1, 9.2 | Policy-gated HTTP fetch with host allowlist, private-address refusal, bounded untrusted output | `packages/web/test/web.test.ts` (8 tests) |
| Section 16; FR-019; section 8.6 | Token-footprint budget gate; git default set made statically read-only (`git.branches`) | `packages/adversarial/test/footprint.test.ts`, `packages/git/test/git.test.ts` |
| Section 13 (SQLite read, P1) | Read-only confined SQLite query with explicit grant | `packages/sqlite/test/sqlite.test.ts` (8 tests) |
| Section 10.1 (MCP client transports, P1) | stdio spawn and Streamable HTTP connect with untrusted registration | `packages/mcp-client/test/connect.test.ts` (6 tests) |
| Section 10.1, 14.2 (Streamable HTTP, P1) | Loopback-default HTTP transport, Origin/Host checks, bearer token, per-session servers | `packages/adapter-mcp/test/http.test.ts` (6 tests) |
| Section 20 (competitive review) | Dated landscape review with sources; interviews and go/no-go still open | docs/competitive-review.md |
| Sections 14, 22 (platform matrix) | Per-tool OS matrix | docs/compatibility.md |
| Section 13 (browser row, P2); section 8.2 browser.control | Policy-gated headless-Chrome tools, zero-dependency CDP | `packages/browser/test/browser.test.ts` (4 tests) |
| Section 17 | Runnable read-only repository assistant and observability/compatibility guides | Example smoke run, build/typecheck and integration tests |

## Deliberately not claimed

No competitor/demand gate, external developer usability test, hosted model benchmark, named desktop MCP-client certification, deployment, publication, container sandbox or broad roadmap catalogue was completed. The original prototype's 89 files are preserved in the baseline commit; this pass is a separate improvement commit. See [VALIDATION.md](../VALIDATION.md) for the remaining gaps and the measured test result.
