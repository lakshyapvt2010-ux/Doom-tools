/**
 * Streamable HTTP transport for the MCP server (PRD 10.1, 14.2; P1).
 *
 * Secure by default: binds to loopback, rejects requests whose Host or Origin
 * is not loopback or explicitly allowed (DNS-rebinding defense), requires a
 * bearer token whenever the bind address is not loopback, caps request bodies,
 * and gives every session its own MCP Server so client capabilities (such as
 * elicitation) are never shared between clients. Policy, approvals, selection
 * and audit still live in the runtime; this file only moves bytes.
 *
 * Limits: no TLS (put a reverse proxy in front for remote use), no OAuth, a
 * single shared bearer token, no per-client rate limiting, sessions are
 * in-memory and capped.
 */

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Toolkit } from "@agentic-tools/runtime";
import { createMcpServer, type ServeMcpOptions } from "./index.js";

export interface ServeMcpHttpOptions extends ServeMcpOptions {
  /** Bind address. Default "127.0.0.1". A non-loopback address requires authToken. */
  host?: string;
  /** Port. Default 0 (ephemeral). */
  port?: number;
  /** Endpoint path. Default "/mcp". */
  path?: string;
  /** Bearer token. Required when host is not loopback. */
  authToken?: string;
  /** Extra allowed Origin values (exact match). Loopback origins are always allowed. */
  allowedOrigins?: string[];
  /** Extra allowed Host header values (exact match, with port). Loopback hosts are always allowed. */
  allowedHosts?: string[];
  /** Max request body bytes. Default 1 MiB. */
  maxBodyBytes?: number;
  /** Max concurrent sessions. Default 32. */
  maxSessions?: number;
}

export interface McpHttpHandle {
  url: string;
  port: number;
  sessions: () => number;
  close: () => Promise<void>;
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost", "[::1]"]);

function isLoopbackHostname(h: string): boolean {
  return LOOPBACK.has(h.toLowerCase());
}

function hostnameOf(hostHeader: string): string {
  if (hostHeader.startsWith("[")) return hostHeader.slice(0, hostHeader.indexOf("]") + 1);
  return hostHeader.split(":")[0] ?? "";
}

function send(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function tokenOk(header: string | undefined, token: string): boolean {
  const m = header?.match(/^Bearer (.+)$/);
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage, max: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > max) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

export async function serveMcpHttp(toolkit: Toolkit, options: ServeMcpHttpOptions = {}): Promise<McpHttpHandle> {
  const host = options.host ?? "127.0.0.1";
  const path = options.path ?? "/mcp";
  const loopbackBind = isLoopbackHostname(host);
  if (!loopbackBind && (!options.authToken || options.authToken.length < 16)) {
    throw new Error("Binding the MCP HTTP server to a non-loopback address requires authToken (at least 16 characters).");
  }
  const maxBody = options.maxBodyBytes ?? 1_048_576;
  const maxSessions = options.maxSessions ?? 32;
  const allowedOrigins = new Set(options.allowedOrigins ?? []);
  const allowedHosts = new Set((options.allowedHosts ?? []).map((h) => h.toLowerCase()));
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>();

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    if (url.pathname !== path) return send(res, 404, "Not found");

    const hostHeader = (req.headers.host ?? "").toLowerCase();
    if (!(isLoopbackHostname(hostnameOf(hostHeader)) || allowedHosts.has(hostHeader))) {
      return send(res, 403, "Host not allowed");
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let ok = allowedOrigins.has(origin);
      if (!ok) {
        try { ok = isLoopbackHostname(new URL(origin).hostname); } catch { ok = false; }
      }
      if (!ok) return send(res, 403, "Origin not allowed");
    }
    if (options.authToken && !tokenOk(req.headers.authorization, options.authToken)) {
      res.setHeader("www-authenticate", "Bearer");
      return send(res, 401, "Unauthorized");
    }

    const sid = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sid) ? sid[0] : sid;

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readBody(req, maxBody);
      } catch (e) {
        return send(res, (e as { status?: number }).status ?? 400, (e as Error).message);
      }
      if (sessionId) {
        const s = sessions.get(sessionId);
        if (!s) return send(res, 404, "Unknown session");
        return s.transport.handleRequest(req, res, body);
      }
      if (!isInitializeRequest(body)) return send(res, 400, "Missing session: send initialize first");
      if (sessions.size >= maxSessions) return send(res, 503, "Too many sessions");
      const server = createMcpServer(toolkit, options);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => { sessions.set(id, { transport, server }); }
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id) sessions.delete(id);
      };
      await server.connect(transport);
      return transport.handleRequest(req, res, body);
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const s = sessionId ? sessions.get(sessionId) : undefined;
      if (!s) return send(res, 404, "Unknown session");
      return s.transport.handleRequest(req, res);
    }
    res.setHeader("allow", "GET, POST, DELETE");
    return send(res, 405, "Method not allowed");
  };

  const http: HttpServer = createServer((req, res) => {
    handler(req, res).catch(() => send(res, 500, "Internal error"));
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(options.port ?? 0, host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  const shownHost = host.includes(":") ? `[${host}]` : host;
  return {
    url: `http://${shownHost}:${port}${path}`,
    port,
    sessions: () => sessions.size,
    close: async () => {
      for (const { transport } of [...sessions.values()]) await transport.close().catch(() => undefined);
      sessions.clear();
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    }
  };
}
