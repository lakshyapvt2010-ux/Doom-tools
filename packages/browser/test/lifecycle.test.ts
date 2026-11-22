import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { launchChrome } from "../src/cdp.js";
import { createBrowserCleanup } from "../src/lifecycle.js";

class ChromeDouble extends EventEmitter {
  pid = 123;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: NodeJS.Signals[] = [];
  ignoreTerm = false;
  kill(signal: NodeJS.Signals) {
    this.signals.push(signal);
    if (signal !== "SIGTERM" || !this.ignoreTerm) {
      setTimeout(() => { this.signalCode = signal; this.emit("exit", null, signal); }, 20);
    }
    return true;
  }
}

test("cleanup awaits Chrome exit, shares concurrent close and retries transient profile removal", async () => {
  const profile = mkdtempSync(join(tmpdir(), "at-cleanup-"));
  const child = new ChromeDouble();
  const before = process.listenerCount("exit");
  let disconnected = 0;
  let removed = 0;
  const close = createBrowserCleanup(child as unknown as ChildProcess, profile, () => { disconnected++; }, async (path, options) => {
    removed++;
    assert.equal(child.signalCode, "SIGTERM", "profile deletion must follow child exit");
    assert.deepEqual(options, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    await rm(path, options);
  });
  const first = close();
  assert.equal(close(), first);
  assert.ok(existsSync(profile), "profile must remain while Chrome is stopping");
  await first;
  await close();
  assert.deepEqual(child.signals, ["SIGTERM"]);
  assert.equal(disconnected, 1);
  assert.equal(removed, 1);
  assert.equal(existsSync(profile), false);
  assert.equal(process.listenerCount("exit"), before);
});

test("cleanup escalates an unresponsive Chrome to SIGKILL before removal", async () => {
  const profile = mkdtempSync(join(tmpdir(), "at-cleanup-"));
  const child = new ChromeDouble();
  child.ignoreTerm = true;
  const close = createBrowserCleanup(child as unknown as ChildProcess, profile, () => {});
  await close();
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(child.signalCode, "SIGKILL");
  assert.equal(existsSync(profile), false);
});

test("cleanup preserves a permanent removal error instead of claiming success", async () => {
  const profile = mkdtempSync(join(tmpdir(), "at-cleanup-"));
  const child = new ChromeDouble();
  child.exitCode = 0;
  const before = process.listenerCount("exit");
  const failure = Object.assign(new Error("permission denied"), { code: "EACCES" });
  const close = createBrowserCleanup(child as unknown as ChildProcess, profile, () => {}, async () => { throw failure; });
  try {
    await assert.rejects(close(), (error: unknown) => error === failure);
    await assert.rejects(close(), (error: unknown) => error === failure);
    assert.deepEqual(child.signals, []);
    assert.ok(existsSync(profile));
    assert.equal(process.listenerCount("exit"), before);
  } finally { rmSync(profile, { recursive: true, force: true }); }
});

function fakeChrome(mode: "exit" | "wait" | "socket") {
  const dir = mkdtempSync(join(tmpdir(), "at-launch-fixture-"));
  const chromePath = join(dir, "chrome.mjs");
  const recordPath = join(dir, "record.json");
  writeFileSync(chromePath, `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
const profile = process.argv.find(arg => arg.startsWith("--user-data-dir="))?.slice(16);
writeFileSync(new URL("./record.json", import.meta.url), JSON.stringify({ profile, pid: process.pid }));
${mode === "exit" ? "process.exit(7);" : mode === "socket" ? 'console.error("DevTools listening on ws://127.0.0.1:0/no-socket"); setInterval(() => {}, 1000);' : "setInterval(() => {}, 1000);"}
`, { mode: 0o755 });
  return { dir, chromePath, recordPath };
}

for (const mode of ["exit", "wait", "socket"] as const) {
  test(`failed launch (${mode}) removes its profile and exit hook`, async () => {
    const fixture = fakeChrome(mode);
    const before = process.listenerCount("exit");
    try {
      await assert.rejects(launchChrome({ chromePath: fixture.chromePath, timeoutMs: mode === "wait" ? 500 : 2000 }), /Chrome|debugging socket/);
      const record = JSON.parse(readFileSync(fixture.recordPath, "utf8")) as { profile: string; pid: number };
      assert.equal(existsSync(record.profile), false);
      assert.throws(() => process.kill(record.pid, 0), { code: "ESRCH" });
      assert.equal(process.listenerCount("exit"), before);
    } finally { rmSync(fixture.dir, { recursive: true, force: true }); }
  });
}

test("a missing Chrome executable cleans up its exit hook", async () => {
  const before = process.listenerCount("exit");
  await assert.rejects(launchChrome({ chromePath: join(tmpdir(), "at-no-such-chrome-executable") }), /Could not launch Chrome/);
  assert.equal(process.listenerCount("exit"), before);
});
