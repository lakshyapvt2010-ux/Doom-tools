# Quickstart

Use a checkout of this repository with Node 22, 24 or 26 on macOS/Linux and pnpm 9.15+. These prototype packages have not been published to npm; do not treat the proposed scope as a verified public installation source.

```bash
pnpm install --frozen-lockfile
pnpm build
node examples/coding-agent/index.mjs
node examples/repository-assistant/index.mjs .
```

The coding example demonstrates read-only selection, policy denial, approval gating and audit. It does not call a hosted model. The repository assistant performs read-only Git and file inspection of the repository path passed to it. Git's actual repository root must be inside the configured workspace; choosing an arbitrary subdirectory of a larger repository is intentionally denied.

## A custom tool in this workspace

Workspace packages can import each other after `pnpm install` and build. For another project, use explicit local workspace/path dependencies until publishing and package-name ownership are settled. A public install command will be added only after a verified release.

```ts
import { createToolkit } from "@agentic-tools/runtime";
import { filesystem } from "@agentic-tools/filesystem";

const toolkit = createToolkit({
  workspace: "./workspace",
  tools: filesystem(),
  policy: { filesystem: "workspace-only" }
});
const result = await toolkit.invoke("filesystem.read", { path: "notes.txt" });
```

Results carry a status, trace ID, timing and optional truncation marker. The same runtime applies through adapters. For a deterministic read/search/edit/test/commit task through MCP and the Vercel SDK, run:

```bash
pnpm --filter @agentic-tools/adversarial-tests test
```

This uses disposable local repositories and a local mock model. It does not certify a hosted provider or autonomous task performance.

## Common first-run errors

- `permission_denied` for a hidden tool: add the operation to the toolkit's explicit selection, if appropriate.
- `permission_denied` for a workspace escape: choose a path inside the configured root. For Git, choose the actual repository root explicitly.
- `approval_required`: configure an appropriate approver or leave the action denied. Stdio MCP cannot use a CLI prompt approver on its transport streams.
- `validation`: check the canonical schema and reported issues.
- Git commit identity missing: configure `user.name` and `user.email` locally in the intended repository. The runtime never invents an author.

See [compatibility.md](compatibility.md), [approvals.md](approvals.md) and [observability.md](observability.md) for tested versions, cancellation and limits.
