# Compatibility matrix

## Platforms and runtimes

The supported Node majors for this prototype are 22, 24 and 26 on macOS/Linux. Node 20 is end-of-life and is no longer in the supported matrix. This follows the [official Node release table](https://nodejs.org/en/about/previous-releases), checked November 22, 2026. Package engines require Node >=22; the CLI checks the declared major-version matrix rather than claiming every newer version is supported.

| Component | Linux local verification | macOS | Windows |
| --- | --- | --- | --- |
| core, runtime, security, adapters, CLI | Node 22.23.5, 24.22.3, 26.13.1 | configured in CI; check workflow result | untested |
| filesystem, Git | same Linux matrix | configured in CI | not at P0 |
| trusted-host Bash | same Linux matrix | configured in CI | unsupported |

CI runs Node 22, 24 and 26 on Ubuntu and macOS with read-only repository permissions. A workflow definition is not proof that its current jobs passed.

## MCP

- Server dependency: `@modelcontextprotocol/sdk` ^1.32.2, with the resolved version locked in `pnpm-lock.yaml`.
- Shipped transport: stdio. Integration tests connect real SDK client/server objects using an in-memory transport.
- Form elicitation accept/deny and caller cancellation are covered. No named desktop client has been certified.
- Streamable HTTP and outbound MCP client connections remain P1 work.

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
