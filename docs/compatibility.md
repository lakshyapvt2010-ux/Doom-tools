# Compatibility matrix

## Platforms and runtimes

The supported Node majors for this prototype are 22, 24 and 26 on macOS/Linux. Node 20 is end-of-life and is no longer in the supported matrix. This follows the [official Node release table](https://nodejs.org/en/about/previous-releases), checked November 22, 2026. Package engines require Node >=22; the CLI checks the declared major-version matrix rather than claiming every newer version is supported.

Per-tool platform matrix (PRD sections 14 and 22). CI run 10 at a718ef6
passed Ubuntu Node 22/24/26 and macOS Node 22, but failed macOS Node 24/26 during
Chrome profile cleanup. PostgreSQL server tests skipped in all six jobs; the
loopback-hostname test also skipped in all macOS jobs. Failed jobs have no final
adversarial-package summary. See [exact counts and limits](../VALIDATION.md).
Run: https://github.com/MRIARC-08/tch-/actions/runs/45052406888 .

Local code 1568650 passes 271 tests on Linux Node 22/24/26, including a cleanup
fix, but has no remote CI result. CI labels below refer to covered a718ef6 cases,
not certification of later local changes or complete success of every job.

| Tool or package | Linux | macOS | Windows | Notes |
| --- | --- | --- | --- | --- |
| core, runtime, security, CLI | tested locally and CI | CI | untested | Pure Node. |
| adapter-mcp (stdio and Streamable HTTP), adapter-vercel | tested locally and CI | CI | untested | HTTP binds to loopback by default. |
| adapter-langchain, adapter-openai-agents | tested locally | latest local changes unverified | untested | Real SDK and native approval loops; no hosted provider. |
| mcp-client, testing | tested locally and CI | package tests completed in CI | untested | In-memory, real stdio spawn and HTTP connection tests are included. |
| filesystem.* | tested locally and CI | CI | not supported at P0 | Path and symlink semantics differ on Windows; not evaluated. |
| git.* | tested locally and CI | CI | not supported at P0 | Needs a host `git` binary. Not a sandbox. |
| web.fetch | tested locally and CI | CI, with one hostname-resolution skip | untested | Uses node:http/node:https; no proxy support. |
| sqlite.query | tested locally and CI | CI | untested | Needs `node:sqlite` (Node 22.5+ with no flag in the tested versions; experimental). |
| postgres.query | server tested locally; 2 CI skips | server tests skipped in CI | untested | Real server tests need initdb/pg_ctl. CI ran the pure validation case only; do not infer server coverage from installed runner packages. |
| browser.* | tested locally and CI | Node 22 passed; Node 24/26 cleanup failures | untested | Local cleanup fix awaits macOS validation. Needs Chrome. Per-request checks do not close DNS rebinding or guarantee private-network isolation. |
| bash.execute (trusted host) | tested locally and CI | CI | unsupported | Spawns `bash`. No containment on any platform. |
| Container or OS isolation backend | not implemented | not implemented | not implemented | Requesting one must fail closed once a backend exists. |

CI runs Node 22, 24 and 26 on Ubuntu and macOS with read-only repository permissions. A workflow definition is not proof that its current jobs passed.

## MCP

- Server dependency: `@modelcontextprotocol/sdk` ^1.32.2, with the resolved version locked in `pnpm-lock.yaml`.
- Shipped transports: stdio and Streamable HTTP (`serveMcpHttp`, `agentic-tools serve --http`; see docs/adapters.md). Integration tests use an in-memory transport, and HTTP tests use the real SDK client over a loopback socket.
- Form elicitation accept/deny and caller cancellation are covered. No named desktop client has been certified.
- The outbound MCP client registers external tools as untrusted. In-memory, real stdio spawn and Streamable HTTP package tests completed in run 10; later local changes remain outside that run.

| Client capability | Behavior |
| --- | --- |
| no elicitation, no out-of-band approver | approval-gated tools hidden; calls fail `permission_denied` with a runtime trace |
| no elicitation, out-of-band approver configured | selected tools exposed; unavailable approvers return `approval_required` |
| form elicitation | client approval attempted first; valid host approvers may handle fallback |
| stdio prompt approver only | not an approval path for MCP; protocol streams are never used for prompts |

## Vercel AI SDK

The adapter is integration-tested with `ai` **5.0.292**, installed only as a development dependency of the test package. Tests use the SDK's actual `generateText` execution loop with `MockLanguageModelV2`; they do not call a hosted model. Production adapter packages do not pull the `ai` package into their dependency tree.

Pass `wrapSchema: jsonSchema` from `ai` v5. Provider naming rules differ, so use `nameForTool` when the provider does not permit canonical names containing dots, for example `name => name.replaceAll(".", "_")`. Name collisions fail before exposure. Runtime tool identity, selection and policy remain canonical.

The SDK's `abortSignal` is forwarded to the runtime. Failure codes remain on `ToolExecutionError.result`, or in the full envelope with `returnEnvelope: true`.

Other SDK majors, hosted providers and live-model task quality are not certified. LangChain core 1.5.0 and OpenAI Agents 0.22.0 adapters are locally tested through actual SDK tool invocation. LangGraph 1.7.5 StateGraph/ToolNode checkpoint interruption/resume and an OpenAI Runner loop with native interruption plus local ScriptedModel are also tested; no hosted model is certified. See docs/adapters.md.
