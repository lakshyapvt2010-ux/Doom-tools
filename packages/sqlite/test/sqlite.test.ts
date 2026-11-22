import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { createToolkit } from "@agentic-tools/runtime";
import { checkQuery, sqlite } from "../src/index.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "at-sqlite-"));
  const db = new DatabaseSync(join(root, "app.db"));
  db.exec("CREATE TABLE t(id INTEGER, name TEXT); INSERT INTO t VALUES (1,'a'),(2,'b'),(3,'c');");
  db.close();
  const outside = mkdtempSync(join(tmpdir(), "at-sqlite-out-"));
  const odb = new DatabaseSync(join(outside, "secret.db"));
  odb.exec("CREATE TABLE s(v TEXT); INSERT INTO s VALUES ('secret');");
  odb.close();
  const kit = (opts = {}) => createToolkit({ workspace: root, tools: sqlite(opts), policy: { capabilities: { "sqlite.read": true } } } as never);
  return { root, outside, kit };
}
const q = (kit: ReturnType<typeof createToolkit>, input: object) => kit.invoke("sqlite.query", input as never);

test("select returns rows, labeled untrusted", async () => {
  const { kit } = fixture();
  const r = await q(kit(), { database: "app.db", sql: "SELECT id, name FROM t WHERE id >= ? ORDER BY id", params: [2] });
  assert.equal(r.status, "success");
  if (r.status === "success") {
    const o = r.output as { rows: unknown[]; untrusted: boolean; truncated: boolean };
    assert.equal(o.untrusted, true);
    assert.deepEqual(o.rows, [{ id: 2, name: "b" }, { id: 3, name: "c" }]);
    assert.equal(o.truncated, false);
  }
});

test("rows are capped with a truncation flag", async () => {
  const { kit } = fixture();
  const r = await q(kit({ maxRows: 2 }), { database: "app.db", sql: "SELECT id FROM t;" });
  assert.equal(r.status, "success");
  if (r.status === "success") {
    const o = r.output as { rows: unknown[]; truncated: boolean };
    assert.equal(o.rows.length, 2);
    assert.equal(o.truncated, true);
  }
});

test("writes, pragma, attach and multiple statements are rejected and data is unchanged", async () => {
  const { kit } = fixture();
  const k = kit();
  for (const sql of [
    "DELETE FROM t",
    "INSERT INTO t VALUES (9,'z')",
    "PRAGMA table_info(t)",
    "SELECT 1; DROP TABLE t",
    "WITH x AS (SELECT 1) DELETE FROM t",
    "ATTACH DATABASE 'x.db' AS x",
    "SELECT load_extension('x')"
  ]) {
    const r = await q(k, { database: "app.db", sql });
    assert.equal(r.status, "error", sql);
  }
  const r = await q(k, { database: "app.db", sql: "SELECT count(*) AS n FROM t" });
  if (r.status === "success") assert.deepEqual((r.output as { rows: unknown[] }).rows, [{ n: 3 }]);
});

test("keywords inside string literals and comments do not trip the guard", () => {
  assert.doesNotThrow(() => checkQuery("SELECT 'delete; drop' AS x -- attach\n"));
  assert.throws(() => checkQuery("SELECT 1 /* ok */; DELETE FROM t"));
});

test("databases outside the workspace and missing files are refused", async () => {
  const { kit, outside } = fixture();
  const k = kit();
  const a = await q(k, { database: join(outside, "secret.db"), sql: "SELECT * FROM s" });
  assert.equal(a.status === "error" && a.error.code, "permission_denied");
  const b = await q(k, { database: "../secret.db", sql: "SELECT 1" });
  assert.equal(b.status, "error");
  const c = await q(k, { database: "nope.db", sql: "SELECT 1" });
  assert.equal(c.status === "error" && c.error.code, "not_found");
});

test("a non-database file fails closed", async () => {
  const { root, kit } = fixture();
  writeFileSync(join(root, "x.db"), "not a database");
  const r = await q(kit(), { database: "x.db", sql: "SELECT * FROM t" });
  assert.equal(r.status, "error");
});

test("sqlite.query is statically read-only", () => {
  const t = sqlite()[0]!;
  assert.equal(t.sideEffect, "read");
});

test("denied without an explicit sqlite.read grant", async () => {
  const { root } = fixture();
  const k = createToolkit({ workspace: root, tools: sqlite() } as never);
  const r = await q(k, { database: "app.db", sql: "SELECT 1" });
  assert.equal(r.status === "error" && r.error.code, "permission_denied");
});
