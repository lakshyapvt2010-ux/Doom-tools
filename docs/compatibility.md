# Compatibility matrix

## Platforms and runtimes

The supported Node majors for this prototype are 22, 24 and 26 on macOS/Linux. Node 20 is end-of-life and is no longer in the supported matrix. This follows the [official Node release table](https://nodejs.org/en/about/previous-releases), checked November 22, 2026. Package engines require Node >=22; the CLI checks the declared major-version matrix rather than claiming every newer version is supported.

## Verified source CI, November 23, 2026

[Run 17](https://github.com/MRIARC-08/tch-/actions/runs/45189379629) at `0782a88` passed all eight jobs:
- Ubuntu and macOS, each on Node 22/24/26: build, strict typecheck and test suites.
- Native Windows Node 22.23.5: build/typecheck and dedicated filesystem/Git
  acceptance covering reads/writes, absolute/relative paths, commit/branch/switch,
  traversal/junction denial, search and cancellation. This is not the full
  Linux/macOS suite and does not certify other tools on Windows.
- Real Linux Docker acceptance: workspace write, non-root user, read-only root,
  no host path/socket exposure, no external interface, bounded filesystem,
  timeout/cancellation and no remaining containers.

Earlier Windows runs failed closed on equivalent short/long path aliases.
Native realpath canonicalization fixed the mismatch without bypassing the
workspace boundary. Remote Git runner bytes match the reviewed local source.
PostgreSQL server coverage remains from the earlier local throwaway-cluster
runs, not the remote matrix. Latest local rerun: 285 pass, 2 PostgreSQL skips;
the earlier three-version local checkpoint had 287 pass and zero skips.
No hosted model, independent security review or external developer trial is
claimed. Docker passing checks are not proof of an escape-free sandbox.
The published `@mriarc/tch-tools@0.1.0-alpha.2` is unchanged; these later source
fixes and CI checks have not been republished to npm.

| Tool or package | Linux | macOS | Windows | Notes |
| --- | --- | --- | --- | --- |
| core, runtime, security, CLI | tested locally and CI | CI | untested | Pure Node. |
| adapter-mcp (stdio and Streamable HTTP), adapter-vercel | tested locally and CI | CI | untested | HTTP binds to loopback by default. |
| adapter-langchain, adapter-openai-agents | tested locally | CI run17 | untested | Real SDK and native approval loops; no hosted provider. |
| mcp-client, testing | tested locally and CI | CI run17 | untested | In-memory, real stdio spawn and HTTP connection tests are included. |
| filesystem.* | tested locally and CI | CI | limited source acceptance | Native Node22 script covers paths/junction denial; not the full suite or current npm alpha. |
| git.* | tested locally and CI | CI | limited source acceptance | Native Node22 commit/branch/switch passed; needs host Git. Not a sandbox. |
| web.fetch | tested locally and CI | CI, with one hostname-resolution skip | untested | Uses node:http/node:https; no proxy support. |
| sqlite.query | tested locally and CI | CI | untested | Needs `node:sqlite` (Node 22.5+ with no flag in the tested versions; experimental). |
| postgres.query | server tested locally; 2 CI skips | server tests skipped in CI | untested | Real server tests need initdb/pg_ctl. CI ran the pure validation case only; do not infer server coverage from installed runner packages. |
| browser.* | tested locally and CI | all CI majors passed in run17 | untested | Cleanup fix verified in run 11. Needs Chrome. Per-request checks do not close DNS rebinding or guarantee private-network isolation. |
| bash.execute (trusted host) | tested locally and CI | CI | unsupported | Spawns `bash`. No containment on any platform. |
| Docker shell | real Linux acceptance passed | unsupported | unsupported | Real-container checks in run17; see docker.md. |
| OS-native isolation backend | not implemented | not implemented | not implemented | P2 roadmap. |

CI runs Node 22, 24 and 26 on Ubuntu and macOS with read-only repository permissions. A workflow definition is not proof that its current jobs passed.

## MCP

- Server dependency: `@modelcontextprotocol/sdk` ^1.32.2, with the resolved version locked in `pnpm-lock.yaml`.
- Shipped transports: stdio and Streamable HTTP (`serveMcpHttp`, `agentic-tools serve --http`; see docs/adapters.md). Integration tests use an in-memory transport, and HTTP tests use the real SDK client over a loopback socket.
- Form elicitation accept/deny and caller cancellation are covered. No named desktop client has been certified.
- The outbound MCP client registers external tools as untrusted. In-memory, real stdio spawn and Streamable HTTP package tests completed again in run17.

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
