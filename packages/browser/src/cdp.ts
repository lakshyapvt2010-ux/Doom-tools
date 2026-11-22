/**
 * Minimal Chrome DevTools Protocol driver over the Node built-in WebSocket.
 * Zero npm dependencies: launches system Chrome headless with a debugging
 * port and speaks flattened sessions. This is not a general automation
 * framework; it covers what the browser tools need and no more.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolError } from "@agentic-tools/core";

export interface CdpSession {
  call<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  close(): Promise<void>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface LaunchedBrowser extends CdpSession {
  /** Attach a fresh page target and return its session id. */
  newTab(): Promise<string>;
}

export async function launchChrome(options: { chromePath?: string; timeoutMs?: number } = {}): Promise<LaunchedBrowser> {
  const chromePath = options.chromePath ?? process.env.AGENTIC_TOOLS_CHROME ?? "google-chrome";
  const profile = mkdtempSync(join(tmpdir(), "at-chrome-"));
  const child: ChildProcess = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsUrl = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new ToolError("provider_error", "Chrome did not expose a debugging port in time")), options.timeoutMs ?? 15000);
    child.on("error", (e) => { clearTimeout(timer); reject(new ToolError("provider_error", `Could not launch Chrome: ${e.message}`)); });
    child.stderr?.on("data", (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]!); }
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new ToolError("provider_error", "Could not connect to Chrome debugging socket"));
  });

  let nextId = 1;
  const pending = new Map<number, Pending>();
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new ToolError("provider_error", `CDP error: ${msg.error.message ?? "unknown"}`));
          else p.resolve(msg.result);
        }
      }
    } catch { /* ignore malformed frames */ }
  };

  async function call<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(payload);
    });
  }

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch { /* ignore */ }
    child.kill("SIGKILL");
    rmSync(profile, { recursive: true, force: true });
  }
  process.once("exit", () => { try { child.kill("SIGKILL"); } catch { /* ignore */ } });

  return {
    call,
    close,
    async newTab() {
      const { targetId } = await call<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      return sessionId;
    }
  };
}

/** Evaluate an expression in a tab; returns the JSON-serializable value. */
export async function evaluate<T>(cdp: CdpSession, sessionId: string, expression: string): Promise<T> {
  const res = await cdp.call<{
    result?: { value?: unknown };
    exceptionDetails?: { exception?: { description?: string }; text?: string };
  }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (res.exceptionDetails) {
    throw new ToolError("provider_error", `Page evaluation failed: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "error"}`.slice(0, 300));
  }
  return res.result?.value as T;
}
