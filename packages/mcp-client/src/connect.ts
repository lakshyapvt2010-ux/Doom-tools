/**
 * Launch or connect to a real MCP server (stdio or Streamable HTTP) and
 * register its tools as untrusted Agentic Tools (PRD 10.1, FR-021; P1 gap:
 * connectMcpTools previously required an already-connected client).
 *
 * Connecting to a server is a trust decision: a stdio command spawns a host
 * process with the user's privileges, and a remote HTTP endpoint receives
 * every call. This helper does not decide that; the host chooses the server
 * explicitly, the runtime still applies policy (mcp.call capability),
 * selection, approvals and audit per call, and every registered tool stays
 * external/high unless the host narrows it with `declare`.
 *
 * stdio limits: the child inherits only the SDK's minimal default environment
 * unless env is given; stderr is piped through for diagnostics. HTTP limits:
 * bearer token only; TLS, redirect and certificate handling are the platform
 * fetch defaults.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectMcpTools, type ConnectedMcpTools, type ConnectMcpOptions } from "./index.js";

export interface McpStdioServer {
  transport: "stdio";
  /** Executable to spawn. No shell is used. */
  command: string;
  args?: string[];
  /** Extra environment on top of the SDK's minimal default set. */
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServer {
  transport: "http";
  /** Absolute http(s) URL of the server's MCP endpoint. */
  url: string;
  /** Bearer token sent as Authorization. */
  authToken?: string;
}

export type McpServerTarget = McpStdioServer | McpHttpServer;

export interface LaunchedMcpServer extends ConnectedMcpTools {
  client: Client;
  close: () => Promise<void>;
}

export async function launchMcpServer(
  target: McpServerTarget,
  options: ConnectMcpOptions & { clientName?: string } = { prefix: "mcp" }
): Promise<LaunchedMcpServer> {
  const client = new Client(
    { name: options.clientName ?? "agentic-tools", version: "0.0.0" },
    { capabilities: {} }
  );
  if (target.transport === "stdio") {
    const params: StdioServerParameters = {
      command: target.command,
      ...(target.args ? { args: target.args } : {}),
      ...(target.env ? { env: target.env } : {}),
      ...(target.cwd ? { cwd: target.cwd } : {}),
      stderr: "pipe"
    };
    await client.connect(new StdioClientTransport(params));
  } else if (target.transport === "http") {
    const url = new URL(target.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("MCP HTTP target must be an http(s) URL");
    }
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: target.authToken
          ? { headers: { authorization: `Bearer ${target.authToken}` } }
          : undefined
      })
    );
  } else {
    throw new Error(`Unknown MCP transport "${String((target as { transport?: unknown }).transport)}"`);
  }
  const { tools, skipped } = await connectMcpTools(client, options);
  return { tools, skipped, client, close: () => client.close() };
}
