/**
 * Reference coding-agent quickstart (PRD 7.1, 14.1, 17).
 *
 * Wires filesystem + git + bash into a toolkit, narrows it to read-only
 * for a planning phase, exercises policy, approval and audit, and prints
 * the result. Run from the repo root after `pnpm install && pnpm build`:
 *
 *   node examples/coding-agent/index.mjs
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createToolkit } from "@agentic-tools/runtime";
import { filesystem } from "@agentic-tools/filesystem";
import { git } from "@agentic-tools/git";
import { bash } from "@agentic-tools/bash";
import { cliApprover } from "@agentic-tools/security";

const here = dirname(fileURLToPath(import.meta.url));

export const config = {
  // One source of truth for the boundary (PRD 7.1).
  workspace: join(here, "workspace"),
  tools: [
    // Operation-level selection: read-only defaults plus explicit writes.
    ...filesystem({ only: ["read", "list", "search", "grep", "write"] }),
    ...git({ only: ["status", "diff", "log"] }),
    // Explicit trusted-host opt-in: host privileges, no containment.
    ...bash({
      mode: "trusted-host",
      namedCommands: [
        { name: "ls", command: "ls", sideEffect: "read", risk: "low" }
      ]
    })
  ],
  policy: {
    filesystem: "workspace-only",
    network: "deny-by-default", // runtime-mediated tools only
    // Unmatched shell commands classify destructive/high and are gated
    // by default (PRD 8.3). A named command narrows only SINGLE simple
    // invocations of that exact executable (no shell operators or
    // expansions); anything else stays destructive/high.
    // filesystem.write asks explicitly.
    approvals: { "filesystem.write": "ask" },
    secrets: [process.env.DEMO_SECRET ?? ""].filter((s) => s.length >= 4)
  },
  // Interactive CLI approval. For non-interactive agents, use
  // fileQueueApprover (polls until an operator decides or the request
  // expires) or no approver at all (calls fail with approval_required).
  approvers: [cliApprover()]
};

const toolkit = createToolkit(config);

// Run-level narrowing (PRD 8.6): a planning phase sees read-only tools.
const planning = toolkit.select({ sideEffect: ["read"] });
const footprint = planning.describeFootprint();
console.log(
  `planning toolkit: ${planning.listTools().length} tools, ~${footprint.totalTokens} tokens of schema`
);

const read = await planning.invoke("filesystem.read", { path: "hello.txt" });
console.log("read:", read.status, read.status === "success" ? read.output.content.trim() : read.error);

// The write operation is not in the planning selection: permission_denied.
const blocked = await planning.invoke("filesystem.write", { path: "x.txt", content: "no" });
console.log("write during planning:", blocked.status, blocked.error?.code);

// A named read-only shell command runs; an unknown command needs approval.
const listed = await toolkit.invoke("bash.execute", { command: "ls -1" });
console.log("named command (ls):", listed.status, listed.error?.code ?? "");

if (process.stdin.isTTY) {
  // Interactive: the CLI approver will ask before running this.
  const danger = await toolkit.invoke("bash.execute", { command: "echo approved-by-you" });
  console.log("unknown command:", danger.status, danger.error?.code ?? "");
} else {
  const danger = await toolkit.invoke("bash.execute", { command: "echo approved-by-you" });
  console.log(
    "unknown command (non-interactive):",
    danger.status,
    danger.error?.code,
    "request:",
    danger.error?.details?.approvalRequestId
  );
}

console.log(`audit events recorded: ${toolkit.auditEvents().length}`);
