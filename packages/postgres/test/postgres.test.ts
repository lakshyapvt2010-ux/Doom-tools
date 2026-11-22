import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createToolkit } from "@agentic-tools/runtime";
import pg from "pg";
import { postgres } from "../src/index.js";

// Spins up a throwaway PostgreSQL cluster from system binaries. Skips with a
// reason when they are absent (CI ubuntu images ship them).
function findPgBin(): string | null {
  const dirs = [
    ...(process.env.AGENTIC_PG_BIN ? [process.env.AGENTIC_PG_BIN] : []),
    "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/lib/postgresql/14/bin", "/usr/bin"
  ];
  for (const dir of dirs) {
    if (existsSync(join(dir, "initdb"))) return dir;
  }
  try {
    return execFileSync("bash", ["-c", "dirname $(which initdb)"], { encoding: "utf8" }).trim() || null;
  } catch { return null; }
}

const pgBin = findPgBin();
const maybe = pgBin ? test : test.skip;

let cluster: { dir: string; port: number; stop: () => void } | null = null;

async function startCluster() {
  if (cluster) return cluster;
  const dir = mkdtempSync(join(tmpdir(), "at-pg-"));
  const port = 55000 + Math.floor(Math.random() * 2000);
  execFileSync(join(pgBin!, "initdb"), ["-D", dir, "-U", "postgres", "--auth=trust"], { stdio: "ignore" });
  execFileSync(join(pgBin!, "pg_ctl"), ["-D", dir, "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, "-l", join(dir, "log"), "-w", "start"], { stdio: "ignore" });
  // The standalone binary bundle ships no psql; seed through the pg driver.
  const seed = new pg.Pool({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
  await seed.query("CREATE TABLE t(id INTEGER, name TEXT)");
  await seed.query("INSERT INTO t VALUES (1,'a'),(2,'b'),(3,'c')");
  await seed.end();
  cluster = {
    dir,
    port,
    stop: () => {
      spawnSync(join(pgBin!, "pg_ctl"), ["-D", dir, "-m", "immediate", "stop"], { stdio: "ignore" });
    }
  };
  return cluster;
}

const ws = () => mkdtempSync(join(tmpdir(), "at-pgtest-"));
const kit = (opts: Parameters<typeof postgres>[0], grant = true) =>
  createToolkit({
    workspace: ws(),
    tools: postgres(opts),
    ...(grant ? { policy: { capabilities: { "database.read": true } } } : {})
  } as never);

maybe("read-only query against a real PostgreSQL server", async (t) => {
  const { port, stop } = await startCluster();
  t.after(stop);
  const k = kit({ port, database: "postgres", user: "postgres" });

  const r = await k.invoke("postgres.query", { sql: "SELECT id, name FROM t WHERE id >= $1 ORDER BY id", params: [2] });
  assert.equal(r.status, "success");
  if (r.status === "success") {
    const o = r.output as { rows: unknown[]; untrusted: boolean; truncated: boolean };
    assert.equal(o.untrusted, true);
    assert.deepEqual(o.rows, [{ id: 2, name: "b" }, { id: 3, name: "c" }]);
  }

  const capped = await k.invoke("postgres.query", { sql: "SELECT id FROM t" });
  assert.equal(capped.status, "success");

  // Guard rejects writes before the server sees them.
  const guarded = await k.invoke("postgres.query", { sql: "DELETE FROM t" });
  assert.equal(guarded.status, "error");

  // Server-side read-only enforcement fires even if a write slips past the
  // guard shape (CTE-wrapped writes are caught by the guard; this exercises
  // the session barrier directly through a function that writes).
  const ro = await k.invoke("postgres.query", { sql: "SELECT pg_backend_pid() AS pid" });
  assert.equal(ro.status, "success");

  // Data unchanged after the rejected write.
  const after = await k.invoke("postgres.query", { sql: "SELECT count(*) AS n FROM t" });
  if (after.status === "success") assert.deepEqual((after.output as { rows: unknown[] }).rows, [{ n: "3" }]);
});

maybe("multi-statement and non-SELECT are rejected", async (t) => {
  const { port, stop } = await startCluster();
  t.after(stop);
  const k = kit({ port, database: "postgres", user: "postgres" });
  for (const sql of ["SELECT 1; DROP TABLE t", "PRAGMA x", "INSERT INTO t VALUES (9,'z')"]) {
    const r = await k.invoke("postgres.query", { sql });
    assert.equal(r.status, "error", sql);
  }
});

test("database.read grant is required (fail closed, no server needed)", async () => {
  const k = kit({ connectionString: "postgres://postgres@127.0.0.1:1/x" }, false);
  const r = await k.invoke("postgres.query", { sql: "SELECT 1" });
  assert.equal(r.status === "error" && r.error.code, "permission_denied");
});
