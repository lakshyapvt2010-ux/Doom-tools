# Agentic Tools

A modular, TypeScript-first toolkit for developers building AI agents: reusable tools, one
canonical tool contract, and a **policy-aware execution runtime** (permissions, approvals,
isolation options, redaction, audit and output limits) that sits beneath whichever protocol
or framework exposes the tools.

> Status: **P0 prototype for review**, built to PRD v0.2. The PRD's section 20 go/no-go
> gate (competitor review + developer interviews) has NOT been completed; see
> [VALIDATION.md](VALIDATION.md) for exactly what that means before adopting any of this.
> Released npm alpha: `@mriarc/tch-tools@0.1.0-alpha.2`, under the MIT license.
> The source monorepo includes experimental packages excluded from the npm build.

## What it is

- **One canonical contract.** Every tool declares name, description, version, JSON Schema
  input, side-effect classification, capabilities and risk (`@agentic-tools/core`).
- **A runtime that enforces the rules outside the model.** Input validation, per-invocation
  classification, policy evaluation, approvals, timeouts, redaction, output budgets, audit
  and tracing, bounded local metrics and caller cancellation (`@agentic-tools/runtime` + `@agentic-tools/security`). Tool descriptions and
  prompts are never security boundaries.
- **Selectable tools.** Workspace-scoped filesystem, Git essentials and trusted-host shell,
  each with minimal read-only defaults (`@agentic-tools/filesystem`, `/git`, `/bash`).
- **Exposure anywhere.** MCP server over stdio (primary surface) and a Vercel AI SDK
  adapter (`@agentic-tools/adapter-mcp`, `/adapter-vercel`). Adapters translate only; they
  cannot bypass policy, approvals, redaction or audit.
- **A CLI** for config validation, tool listing with token footprint, platform diagnostics
  and launching the MCP server (`@agentic-tools/cli`).

It is not an LLM, an agent orchestrator, or a replacement for LangGraph, the Vercel AI SDK,
the OpenAI Agents SDK or MCP. It supplies capabilities those systems can invoke.

## Requirements

- Node.js 22, 24 or 26, macOS or Linux. Windows has limited source-level filesystem/Git acceptance only; the published alpha predates those fixes. See the [compatibility matrix](docs/compatibility.md).
- pnpm 9.15+ for the monorepo.

## Quickstart

For the published single-package alpha:

```bash
npm install @mriarc/tch-tools
```

The `latest` and `alpha` npm tags currently select `0.1.0-alpha.2`. See
[the package guide](release/README.md) for usage. The `@agentic-tools/*` names below
are source-workspace packages, not separately published npm packages. For source development:

```bash
pnpm install
pnpm build
node examples/coding-agent/index.mjs   # approval/selection wiring, no model required
node examples/repository-assistant/index.mjs .  # read-only repository inspection
```

Minimal use in your own project:

```ts
import { createToolkit } from "@agentic-tools/runtime";
import { filesystem } from "@agentic-tools/filesystem";
import { git } from "@agentic-tools/git";
import { bash } from "@agentic-tools/bash";
import { cliApprover } from "@agentic-tools/security";

const toolkit = createToolkit({
  workspace: "./workspace",              // single source of truth for the boundary
  tools: [
    ...filesystem({ only: ["read", "list", "search", "grep"] }), // read-only default
    ...git(),                                                        // status/diff/log/branch
    ...bash({ mode: "trusted-host" })                                // explicit opt-in
  ],
  policy: {
    filesystem: "workspace-only",
    network: "deny-by-default",          // runtime-mediated tools only (see docs/security.md)
    approvals: { "filesystem.write": "ask" }
  },
  approvers: [cliApprover()]
});

// Run-level narrowing: a planning phase sees read-only tools only.
const planning = toolkit.select({ sideEffect: ["read"] });

const result = await planning.invoke("filesystem.read", { path: "README.md" });
// Calls to non-selected tools fail with permission_denied, even guessed names.

// Expose through MCP (primary) or the framework adapter:
//   import { serveMcp } from "@agentic-tools/adapter-mcp";
//   await serveMcp(planning, { transport: "stdio" });
//   import { toVercelAI } from "@agentic-tools/adapter-vercel";
//   const tools = toVercelAI(planning);
```

## Packages

| Package | Purpose |
| --- | --- |
| `@agentic-tools/core` | Canonical contract, result envelope, `defineTool` / `defineZodTool` SDK. Zero dependencies. |
| `@agentic-tools/security` | Policy engine, capability permissions, approval flow + approvers, redaction, audit. |
| `@agentic-tools/runtime` | Invocation lifecycle, registry, selection, output shaping, traces, local metrics and cancellation. |
| `@agentic-tools/filesystem` | read, list, search, grep, diff (default); write, edit (opt-in). Workspace-confined. |
| `@agentic-tools/git` | status, diff, log, branch (default); switch, add, reset, commit (opt-in). |
| `@agentic-tools/bash` | Trusted-host shell. Host privileges, **no containment**; approval-gated by default. |
| `@agentic-tools/adapter-mcp` | MCP server (stdio). Hides approval-gated tools from clients that cannot approve. |
| `@agentic-tools/adapter-vercel` | Vercel AI SDK tool map; stable error codes preserved. |
| `@agentic-tools/cli` | `doctor`, `tools list --tokens`, `validate`, `serve`, `approvals`. |
| `@agentic-tools/adversarial-tests` | FR-023 adversarial suite; runs in CI and gates releases. |

## CLI

```bash
node packages/cli/dist/src/cli.js doctor                 # platform capability report
node packages/cli/dist/src/cli.js validate               # config check + honest warnings
node packages/cli/dist/src/cli.js tools list --tokens    # exposed tools + token footprint
node packages/cli/dist/src/cli.js serve                  # MCP server on stdio
node packages/cli/dist/src/cli.js approvals list         # pending file-queue approvals
```

Config defaults to `./agentic-tools.config.mjs`; see
[examples/coding-agent/agentic-tools.config.mjs](examples/coding-agent/agentic-tools.config.mjs).

## Security model in one paragraph

Filesystem tools are confined to the policy workspace (traversal- and symlink-checked at both
the tool and the policy layer). Shell runs in **trusted-host mode only**: host privileges, no
containment, explicit opt-in, approval-gated by default; there is no "restricted" shell mode
because allowlists are not a boundary. Network policy is deny-by-default but cannot be
enforced for host-mode shell, and the CLI says so. Approvals are runtime-owned objects bound
to the exact classified input, with pluggable approvers (callback, CLI prompt, file queue,
MCP elicitation); with no approver a gated call fails with `approval_required` and is never
auto-approved. Secret redaction is best-effort over outputs, errors, traces and audit. The
adversarial suite (`packages/adversarial`) covers traversal, symlink escape, injection,
prompt-injection fixtures, secret canaries, approval bypass through every adapter, and
cancellation cleanup.

## Development

```bash
pnpm install
pnpm build       # all packages
pnpm typecheck
pnpm test        # unit, adversarial and real-SDK integration tests
```

CI (`.github/workflows/ci.yml`) runs build, typecheck and tests on Node 22, 24 and 26,
Ubuntu and macOS. See [VALIDATION.md](VALIDATION.md) for measured local results and
remaining release gates. The deterministic repository-task test uses real MCP and
Vercel SDK execution with a local mock model, not a hosted provider.

## Honest scope

Implemented at P0 (PRD 14.1): contract/SDK, runtime, policy/approvals/redaction/audit,
filesystem/Git/bash tools, selection at all four levels, output budgets and truncation,
tracing, bounded local metrics, CLI, MCP server (stdio), one framework adapter,
adversarial/integration tests, and coding/repository examples.
Later source extensions include MCP client/Streamable HTTP, web/database/browser tools,
mock/replay and additional adapters. Source CI passed real Linux Docker acceptance and dedicated native Windows
filesystem/Git checks in run17. This is limited test evidence, not security
certification; the published npm alpha is unchanged.
Remote sandbox backends and the broader P2/P3 roadmap remain open. See
[VALIDATION.md](VALIDATION.md) and [docs/compatibility.md](docs/compatibility.md).

## Documentation

- [docs/observability.md](docs/observability.md): traces, local metrics, cancellation and retention limits
- [docs/prd-alignment.md](docs/prd-alignment.md): this improvement pass mapped to PRD requirements

- [docs/quickstart.md](docs/quickstart.md) — install to first invocation
- [docs/security.md](docs/security.md) — trust modes and their real guarantees
- [docs/approvals.md](docs/approvals.md) — approvers and non-interactive behavior
- [docs/openai-approvals.md](docs/openai-approvals.md) - explicit SDK interruption/runtime-ticket bridge
- [docs/langgraph-approvals.md](docs/langgraph-approvals.md) - native checkpoint/interrupt approval bridge
- [docs/output-budgets.md](docs/output-budgets.md) - toolkit/per-tool payload and whole-envelope byte/token caps
- [docs/selection.md](docs/selection.md) — the four selection levels and token footprint
- [docs/tools.md](docs/tools.md) — tool reference
- [docs/adapters.md](docs/adapters.md) — MCP and Vercel AI SDK
- [docs/custom-tools.md](docs/custom-tools.md) — authoring custom tools
- [docs/testing.md](docs/testing.md) — mock, record and replay (FR-014)
- [docs/mcp-client.md](docs/mcp-client.md) — external MCP servers as untrusted tools
- [docs/web.md](docs/web.md) — policy-gated HTTP fetch
- [docs/browser.md](docs/browser.md) — headless-Chrome browser tools (P2)
- [docs/sqlite.md](docs/sqlite.md) — read-only SQLite queries
- [docs/postgres.md](docs/postgres.md) — read-only PostgreSQL queries
- [docs/footprint.md](docs/footprint.md) — token-footprint regression gate
- [docs/competitive-review.md](docs/competitive-review.md) — section 20 landscape review (interviews pending)
- [docs/troubleshooting.md](docs/troubleshooting.md) — common errors
- [docs/compatibility.md](docs/compatibility.md) — platform and client matrix

Remaining scope and release gates: [docs/remaining-work.md](docs/remaining-work.md).
