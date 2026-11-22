/**
 * CLI config for the example (used by `agentic-tools validate|tools list|serve`).
 *
 *   node packages/cli/dist/src/cli.js validate --config examples/coding-agent/agentic-tools.config.mjs
 *   node packages/cli/dist/src/cli.js tools list --tokens --config examples/coding-agent/agentic-tools.config.mjs
 *   node packages/cli/dist/src/cli.js serve --config examples/coding-agent/agentic-tools.config.mjs
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { filesystem } from "@agentic-tools/filesystem";
import { git } from "@agentic-tools/git";
import { bash } from "@agentic-tools/bash";
import { cliApprover } from "@agentic-tools/security";

const here = dirname(fileURLToPath(import.meta.url));

export default {
  workspace: join(here, "workspace"),
  tools: [
    ...filesystem({ only: ["read", "list", "search", "grep", "write"] }),
    ...git({ only: ["status", "diff", "log"] }),
    ...bash({ mode: "trusted-host" })
  ],
  policy: {
    filesystem: "workspace-only",
    network: "deny-by-default",
    approvals: { "filesystem.write": "ask" }
  },
  approvers: [cliApprover()]
};
