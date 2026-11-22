import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@agentic-tools/core";
import { git } from "../src/index.js";

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "at-git-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  command("init", "-q"); command("config", "user.name", "Fixture"); command("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "file.txt"), "first"); command("add", "."); command("commit", "-qm", "baseline");
  const ctx: ToolContext = { workspace: root, traceId: "fixture", signal: new AbortController().signal,
    logger: { debug() {}, info() {}, warn() {}, error() {} }, services: {} };
  return { root, command, ctx };
}

test("enclosing repository outside the workspace cannot commit unrelated staged files", async (t) => {
  const { root, command, ctx } = fixture(t);
  const child = join(root, "limited-workspace"); mkdirSync(child);
  writeFileSync(join(root, "file.txt"), "unrelated staged change"); command("add", "file.txt");
  const before = command("rev-parse", "HEAD");
  const commit = git({ only: ["commit"] })[0]!;
  const result = await commit.execute({ message: "must not commit parent" }, { ...ctx, workspace: child });
  assert.equal(result.status === "error" && result.error.code, "permission_denied");
  assert.equal(command("rev-parse", "HEAD"), before);
});

test("Git tool commits do not execute repository hooks", async (t) => {
  const { root, ctx } = fixture(t);
  writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nprintf hook-ran > hook-marker\n", { mode: 0o755 });
  const commit = git({ only: ["commit"] })[0]!;
  const result = await commit.execute({ message: "safe fixture", allowEmpty: true }, ctx);
  assert.equal(result.status, "success", JSON.stringify(result));
  assert.equal(existsSync(join(root, "hook-marker")), false);
});

test("host GIT_DIR cannot redirect the repository tool", async (t) => {
  const { ctx } = fixture(t);
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = "/nonexistent-git-dir-fixture";
  try {
    const result = await git({ only: ["status"] })[0]!.execute({}, ctx);
    assert.equal(result.status, "success", JSON.stringify(result));
  } finally {
    if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous;
  }
});

test("Git forwards caller cancellation before spawning", async (t) => {
  const { ctx } = fixture(t);
  const controller = new AbortController(); controller.abort();
  const result = await git({ only: ["status"] })[0]!.execute({}, { ...ctx, signal: controller.signal });
  assert.equal(result.status === "error" && result.error.code, "cancelled");
});
