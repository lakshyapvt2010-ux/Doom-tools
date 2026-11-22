# Quickstart

From a clean checkout (Node >= 20, macOS or Linux, pnpm 9.15+):

```bash
pnpm install
pnpm build
node examples/coding-agent/index.mjs
```

The example wires filesystem, Git and bash into one toolkit, narrows it to read-only for a
planning phase, and shows policy denial, approval gating and audit in a few lines of output.

## Your own project

1. `pnpm add @agentic-tools/core @agentic-tools/runtime @agentic-tools/filesystem`
2. Create a toolkit (see README for the full example):

```ts
import { createToolkit } from "@agentic-tools/runtime";
import { filesystem } from "@agentic-tools/filesystem";

const toolkit = createToolkit({
  workspace: "./workspace",
  tools: filesystem(), // read-only default set
  policy: { filesystem: "workspace-only" }
});

const result = await toolkit.invoke("filesystem.read", { path: "notes.txt" });
```

3. Every result is the same envelope: `status: "success" | "error"`, stable error codes,
   `traceId`, `timing`, optional `truncation`. Errors explain how to fix configuration.

## Common first-run errors

- `permission_denied: Tool "x" is not exposed` — the tool was not selected for this
  toolkit/run/server. Add it to `tools` (and the operation to the package's `only`).
- `permission_denied: ... escapes workspace root` — the path (or a symlink on it) resolves
  outside `workspace`. Pass a path inside the root.
- `approval_required` — policy requires approval and no approver is configured. Add
  `cliApprover()` for interactive use or `fileQueueApprover` for non-interactive.
- `validation` — input failed the tool's JSON Schema; `error.details.issues` lists why.
