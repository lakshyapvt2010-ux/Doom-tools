# Compatibility matrix

## Platforms and runtimes

The supported Node majors for this prototype are 22, 24 and 26 on macOS/Linux. Node 20 is end-of-life and is no longer in the supported matrix. This follows the [official Node release table](https://nodejs.org/en/about/previous-releases), checked November 22, 2026. Package engines require Node >=22; the CLI checks the declared major-version matrix rather than claiming every newer version is supported.

Per-tool platform matrix (PRD sections 14 and 22). "CI" means the workflow runs it on Ubuntu and macOS for Node 22, 24 and 26; check the actual run result before calling a platform green. Last checked run: https://github.com/MRIARC-08/tch-/actions (run 9, all 6 jobs passed).

| Tool or package | Linux | macOS | Windows | Notes |
| --- | --- | --- | --- | --- |
| core, runtime, security, CLI | tested locally and CI | CI | untested | Pure Node. |
| adapter-mcp (stdio and Streamable HTTP), adapter-vercel | tested locally and CI | CI | untested | HTTP binds to loopback by default. |
| mcp-client, testing | tested locally and CI | CI | untested | MCP client tested with an in-memory transport only. |
| filesystem.* | tested locally and CI | CI | not supported at P0 | Path and symlink semantics differ on Windows; not evaluated. |
| git.* | tested locally and CI | CI | not supported at P0 | Needs a host `git` binary. Not a sandbox. |
| web.fetch | tested locally and CI | CI | untested | Uses `node:http`/`node:https`; no proxy support. |
| sqlite.query | tested locally and CI | CI | untested | Needs `node:sqlite` (Node 22.5+ with no flag in the tested versions; experimental). |
| postgres.query | tested locally | unverified until next CI run | untested | Needs a reachable PostgreSQL server; tests need `initdb`/`pg_ctl` binaries (skip otherwise). GitHub ubuntu runners ship them; macOS runners may not, so tests may skip there. |
| browser.* | tested locally | unverified until next CI run | untested | Needs a Chrome binary. Per-request network interception mitigates but does not close DNS rebinding; private-network isolation is not guaranteed. |
| bash.execute (trusted host) | tested locally and CI | CI | unsupported | Spawns `bash`. No containment on any platform. |
| Container or OS isolation backend | not implemented | not implemented | not implemented | Requesting one must fail closed once a backend exists. |

CI runs Node 22, 24 and 26 on Ubuntu and macOS with read-only repository permissions. A workflow definition is not proof that its current jobs passed.

## MCP

- Server dependency: `@modelcontextprotocol/sdk` ^1.32.2, with the resolved version locked in `pnpm-lock.yaml`.
- Shipped transports: stdio and Streamable HTTP (`serveMcpHttp`, `agentic-tools serve --http`; see docs/adapters.md). Integration tests use an in-memory transport, and HTTP tests use the real SDK client over a loopback socket.
- Form elicitation accept/deny and caller cancellation are covered. No named desktop client has been certified.
- The outbound MCP client (`@agentic-tools/mcp-client`) registers external tools as untrusted; it has been tested only against an in-memory transport, not stdio or HTTP server launching.

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

Other SDK majors, hosted providers and live-model task quality are not certified. LangChain/LangGraph and OpenAI Agents adapters remain P1 work.
