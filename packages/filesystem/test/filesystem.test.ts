import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filesystem } from "../src/index.js";
import type { ToolContext, ToolResult } from "@agentic-tools/core";

function fixture(): { root: string; ctx: ToolContext } {
  const root = mkdtempSync(join(tmpdir(), "at-fs-"));
  mkdirSync(join(root, "src", "deep"), { recursive: true });
  writeFileSync(join(root, "a.txt"), "alpha\nbeta\ngamma\n");
  writeFileSync(join(root, "src", "b.ts"), "const beta = 1;\n");
  writeFileSync(join(root, "src", "deep", "c.txt"), "gamma ray\n");
  const ctx = {
    traceId: "t",
    signal: new AbortController().signal,
    workspace: root,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    services: {}
  } as ToolContext;
  return { root, ctx };
}

function find(tools: ReturnType<typeof filesystem>, name: string) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name} not exposed`);
  return tool;
}

async function run<T>(tool: ReturnType<typeof find>, input: unknown, ctx: ToolContext): Promise<ToolResult<T>> {
  return tool.execute(input, ctx) as Promise<ToolResult<T>>;
}

test("default set is read-only; write ops are opt-in", () => {
  const names = filesystem().map((t) => t.name);
  assert.deepEqual(names.sort(), [
    "filesystem.diff",
    "filesystem.grep",
    "filesystem.list",
    "filesystem.read",
    "filesystem.search"
  ]);
  const withWrite = filesystem({ only: ["read", "write"] }).map((t) => t.name);
  assert.deepEqual(withWrite.sort(), ["filesystem.read", "filesystem.write"]);
  assert.throws(() => filesystem({ only: ["nope" as never] }));
});

test("read returns content and paginates by byte offset", async () => {
  const { ctx } = fixture();
  const read = find(filesystem(), "filesystem.read");
  const res = await run<{ content: string }>(read, { path: "a.txt" }, ctx);
  assert.equal(res.status, "success");
  if (res.status === "success") assert.match(res.output.content, /alpha/);

  const partial = await run<{ content: string }>(read, { path: "a.txt", offset: 6, limit: 4 }, ctx);
  assert.equal(partial.status, "success");
  if (partial.status === "success") assert.equal(partial.output.content, "beta");
  assert.equal(partial.truncation?.truncated, true);
  assert.match(partial.truncation?.continuation ?? "", /offset 10/);
});

test("traversal and symlink escapes are denied (FR-007)", async () => {
  const { root, ctx } = fixture();
  const read = find(filesystem(), "filesystem.read");
  const outside = await run(read, { path: "../../etc/passwd" }, ctx);
  assert.equal(outside.status, "error");
  if (outside.status === "error") assert.equal(outside.error.code, "permission_denied");

  // symlink inside the workspace pointing outside must not be followed
  symlinkSync("/etc/hostname", join(root, "escape.txt"));
  const viaLink = await run(read, { path: "escape.txt" }, ctx);
  assert.equal(viaLink.status, "error");
  if (viaLink.status === "error") assert.equal(viaLink.error.code, "permission_denied");
});

test("list paginates with a cursor", async () => {
  const { root, ctx } = fixture();
  for (let i = 0; i < 5; i++) writeFileSync(join(root, `f${i}.txt`), "x");
  const list = find(filesystem(), "filesystem.list");
  const page1 = await run<{ items: unknown[]; nextCursor?: string }>(list, { limit: 3 }, ctx);
  assert.equal(page1.status, "success");
  if (page1.status !== "success") return;
  assert.equal(page1.output.items.length, 3);
  assert.ok(page1.output.nextCursor);
  const page2 = await run<{ items: { name: string }[]; nextCursor?: string }>(
    list,
    { limit: 3, cursor: page1.output.nextCursor },
    ctx
  );
  assert.equal(page2.status, "success");
  if (page2.status !== "success") return;
  assert.ok(page2.output.items.length >= 2);
});

test("search matches globs including **", async () => {
  const { ctx } = fixture();
  const search = find(filesystem(), "filesystem.search");
  const res = await run<{ items: string[] }>(search, { pattern: "**/*.ts" }, ctx);
  assert.equal(res.status, "success");
  if (res.status === "success") assert.deepEqual(res.output.items, ["src/b.ts"]);
});

test("grep finds lines with numbers", async () => {
  const { ctx } = fixture();
  const grep = find(filesystem(), "filesystem.grep");
  const res = await run<{ items: { path: string; line: number }[]; totalMatches: number }>(
    grep,
    { pattern: "gamma" },
    ctx
  );
  assert.equal(res.status, "success");
  if (res.status === "success") {
    assert.equal(res.output.totalMatches, 2);
    assert.deepEqual(
      res.output.items.map((i) => [i.path, i.line]).sort(),
      [["a.txt", 3], ["src/deep/c.txt", 1]]
    );
  }
});

test("diff reports changes as unified text", async () => {
  const { root, ctx } = fixture();
  writeFileSync(join(root, "b.txt"), "alpha\nBETA\ngamma\n");
  const diff = find(filesystem(), "filesystem.diff");
  const res = await run<{ changed: boolean; unified: string }>(
    diff,
    { pathA: "a.txt", pathB: "b.txt" },
    ctx
  );
  assert.equal(res.status, "success");
  if (res.status === "success") {
    assert.equal(res.output.changed, true);
    assert.match(res.output.unified, /-beta/);
    assert.match(res.output.unified, /\+BETA/);
  }
});

test("write and edit stay inside the workspace", async () => {
  const { root, ctx } = fixture();
  const tools = filesystem({ only: ["read", "write", "edit"] });
  const write = find(tools, "filesystem.write");
  const res = await run(write, { path: "new/dir/out.txt", content: "hello", createParents: true }, ctx);
  assert.equal(res.status, "success");
  const edit = find(tools, "filesystem.edit");
  const edited = await run(edit, { path: "new/dir/out.txt", edits: [{ find: "hello", replace: "world" }] }, ctx);
  assert.equal(edited.status, "success");
  const read = find(tools, "filesystem.read");
  const back = await run<{ content: string }>(read, { path: "new/dir/out.txt" }, ctx);
  if (back.status === "success") assert.equal(back.output.content, "world");

  const escape = await run(write, { path: "../out.txt", content: "no" }, ctx);
  assert.equal(escape.status, "error");
  if (escape.status === "error") assert.equal(escape.error.code, "permission_denied");
});

test("factory root may narrow but never widen the workspace", async () => {
  const { root, ctx } = fixture();
  const narrowed = filesystem({ root: "src" });
  const read = find(narrowed, "filesystem.read");
  const ok = await run<{ content: string }>(read, { path: "b.ts" }, ctx);
  assert.equal(ok.status, "success");
  const denied = await run(read, { path: "../a.txt" }, ctx);
  assert.equal(denied.status, "error");
  if (denied.status === "error") assert.equal(denied.error.code, "permission_denied");

  const widening = filesystem({ root: ".." });
  const wread = find(widening, "filesystem.read");
  const wres = await run(wread, { path: "a.txt" }, ctx);
  assert.equal(wres.status, "error"); // never widens beyond ctx.workspace
});
