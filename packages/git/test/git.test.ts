import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/index.js";
import type { ToolContext, ToolResult } from "@agentic-tools/core";

function fixture(): { root: string; ctx: ToolContext } {
  const root = mkdtempSync(join(tmpdir(), "at-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "T"], { cwd: root });
  writeFileSync(join(root, "a.txt"), "one\n");
  execFileSync("git", ["add", "a.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: root });
  const ctx = {
    traceId: "t",
    signal: new AbortController().signal,
    workspace: root,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    services: {}
  } as ToolContext;
  return { root, ctx };
}

function find(tools: ReturnType<typeof git>, name: string) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `${name} not exposed`);
  return tool;
}

async function run<T>(tool: ReturnType<typeof find>, input: unknown, ctx: ToolContext): Promise<ToolResult<T>> {
  return tool.execute(input, ctx) as Promise<ToolResult<T>>;
}

test("default set is read-only", () => {
  assert.deepEqual(
    git().map((t) => t.name).sort(),
    ["git.branch", "git.diff", "git.log", "git.status"]
  );
});

test("status, log, branch list work on a clean repo", async () => {
  const { ctx } = fixture();
  const tools = git();
  const status = await run<{ clean: boolean; branch: string }>(find(tools, "git.status"), {}, ctx);
  assert.equal(status.status, "success");
  if (status.status === "success") {
    assert.equal(status.output.clean, true);
    assert.equal(status.output.branch, "main");
  }
  const log = await run<{ commits: { subject: string }[] }>(find(tools, "git.log"), {}, ctx);
  if (log.status === "success") assert.equal(log.output.commits[0]?.subject, "initial");
  const branch = await run<{ branches: string[] }>(find(tools, "git.branch"), {}, ctx);
  if (branch.status === "success") assert.deepEqual(branch.output.branches, ["main"]);
});

test("write flow: branch create, switch, add, commit, reset", async () => {
  const { root, ctx } = fixture();
  const tools = git({ only: ["status", "diff", "branch", "switch", "add", "reset", "commit"] });
  writeFileSync(join(root, "b.txt"), "two\n");

  const br = await run(find(tools, "git.branch"), { create: "feature" }, ctx);
  assert.equal(br.status, "success");
  const sw = await run(find(tools, "git.switch"), { branch: "feature" }, ctx);
  assert.equal(sw.status, "success");
  const add = await run(find(tools, "git.add"), { pathspec: ["b.txt"] }, ctx);
  assert.equal(add.status, "success");
  const commit = await run<{ sha: string }>(
    find(tools, "git.commit"),
    { message: "add b" },
    ctx
  );
  assert.equal(commit.status, "success");
  if (commit.status === "success") assert.match(commit.output.sha, /^[0-9a-f]{40}$/);

  writeFileSync(join(root, "c.txt"), "three\n");
  await run(find(tools, "git.add"), { pathspec: ["c.txt"] }, ctx);
  const reset = await run(find(tools, "git.reset"), { pathspec: ["c.txt"] }, ctx);
  assert.equal(reset.status, "success");
});

test("branch classify narrows to read when only listing", () => {
  const tools = git();
  const branch = find(tools, "git.branch");
  const clsRead = branch.classify?.({});
  assert.equal(clsRead?.sideEffect, "read");
  const clsWrite = branch.classify?.({ create: "x" });
  assert.equal(clsWrite?.sideEffect, "write");
  // declared static sideEffect is write; read listing narrows to read
  assert.equal(branch.sideEffect, "write");
});

test("flag injection through refs and pathspecs is rejected", async () => {
  const { ctx } = fixture();
  const tools = git({ only: ["log", "add"] });
  const log = await run(find(tools, "git.log"), { ref: "--exec=rm" }, ctx);
  assert.equal(log.status, "error");
  if (log.status === "error") assert.equal(log.error.code, "validation");
  const add = await run(find(tools, "git.add"), { pathspec: ["-f"] }, ctx);
  assert.equal(add.status, "error");
  if (add.status === "error") assert.equal(add.error.code, "validation");
});

test("repo path outside the workspace is denied", async () => {
  const { ctx } = fixture();
  const status = await run(find(git(), "git.status"), { path: "/etc" }, ctx);
  assert.equal(status.status, "error");
  if (status.status === "error") assert.equal(status.error.code, "permission_denied");
});
