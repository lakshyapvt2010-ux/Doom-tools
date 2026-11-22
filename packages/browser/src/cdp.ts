/**
 * Minimal Chrome DevTools Protocol driver over the Node built-in WebSocket.
 * Zero npm dependencies: launches system Chrome headless with a debugging
 * port and speaks flattened sessions. This is not a general automation
 * framework; it covers what the browser tools need and no more.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolError } from "@agentic-tools/core";
import { createBrowserCleanup } from "./lifecycle.js";

export interface CdpSession {
  call<T = unknown>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
  /** Subscribe to CDP events (optionally scoped to a session id). */
  onEvent(method: string, cb: (params: Record<string, unknown>, sessionId?: string) => void): void;
  close(): Promise<void>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

/** First Chrome/Chromium binary resolvable on this platform. */
export function findChrome(): string {
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      execFileSync("which", [name], { stdio: ["ignore", "pipe", "ignore"] });
      return name;
    } catch { /* not on PATH */ }
  }
  for (const abs of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium"
  ]) {
    if (existsSync(abs)) return abs;
  }
  return "google-chrome"; // surfaces a clear spawn error if truly absent
}

export interface LaunchedBrowser extends CdpSession {
  /** Attach a fresh page target and return its session id. */
  newTab(): Promise<string>;
}

export async function launchChrome(options: { chromePath?: string; timeoutMs?: number } = {}): Promise<LaunchedBrowser> {
  const chromePath = options.chromePath ?? process.env.AGENTIC_TOOLS_CHROME ?? findChrome();
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

  let socket: WebSocket | undefined;
  const close = createBrowserCleanup(child, profile, () => socket?.close());
  let ws: WebSocket;
  try {
    const wsUrl = await new Promise<string>((resolve, reject) => {
      let buf = "";
      const finish = (error?: Error, url?: string) => {
        clearTimeout(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        child.stderr?.removeListener("data", onData);
        if (error) reject(error); else resolve(url!);
      };
      const onError = (error: Error) => finish(new ToolError("provider_error", `Could not launch Chrome: ${error.message}`));
      const onExit = () => finish(new ToolError("provider_error", "Chrome exited before exposing a debugging port"));
      const onData = (data: Buffer) => {
        buf = (buf + data.toString()).slice(-65536);
        const match = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) finish(undefined, match[1]!);
      };
      const timer = setTimeout(() => finish(new ToolError("provider_error", "Chrome did not expose a debugging port in time")), options.timeoutMs ?? 15000);
      child.once("error", onError);
      child.once("exit", onExit);
      child.stderr?.on("data", onData);
    });

    ws = socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        if (error) reject(error); else resolve();
      };
      const timer = setTimeout(() => finish(new ToolError("provider_error", "Chrome debugging socket connection timed out")), options.timeoutMs ?? 15000);
      ws.onopen = () => finish();
      ws.onerror = () => finish(new ToolError("provider_error", "Could not connect to Chrome debugging socket"));
      ws.onclose = () => finish(new ToolError("provider_error", "Chrome debugging socket closed before connecting"));
    });
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Chrome launch failed and cleanup was incomplete");
    }
    throw error;
  }

  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners: { method: string; cb: (params: Record<string, unknown>, sessionId?: string) => void }[] = [];
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: unknown;
        error?: { message?: string };
        method?: string;
        params?: Record<string, unknown>;
        sessionId?: string;
      };
      if (msg.id !== undefined) {
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          if (msg.error) p.reject(new ToolError("provider_error", `CDP error: ${msg.error.message ?? "unknown"}`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        for (const l of listeners) {
          if (l.method === msg.method) l.cb(msg.params ?? {}, msg.sessionId);
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


  return {
    call,
    close,
    onEvent(method, cb) {
      listeners.push({ method, cb });
    },
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
