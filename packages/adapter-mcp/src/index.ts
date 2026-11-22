/**
 * @agentic-tools/adapter-mcp — expose a toolkit through an MCP server
 * (PRD 10.1, 10.3; FR-012). stdio transport at P0.
 *
 * The adapter TRANSLATES only: schemas, call arguments and errors. All
 * validation, policy, approvals, redaction, budgets and audit happen in
 * the runtime (PRD 10.2: no adapter may bypass them).
 *
 * Client support matters (PRD 10.3): tools whose static metadata requires
 * approval are NOT exposed to a client that cannot present an approval
 * (no elicitation support) unless the toolkit has an out-of-band approver
 * configured. The runtime also re-checks on every call, so a guessed or
 * hallucinated name gets permission_denied, never execution (FR-019).
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition, ToolResult } from "@agentic-tools/core";
import type { Toolkit } from "@agentic-tools/runtime";
import {
  approvalRuleFor,
  type Approver,
  type ApprovalRequest
} from "@agentic-tools/security";

export interface ServeMcpOptions {
  /** Server identity reported to clients. */
  name?: string;
  version?: string;
  /** stdio via serveMcp; Streamable HTTP via serveMcpHttp. */
  transport?: "stdio";
}

interface ClientCaps {
  elicitation?: unknown;
}

/** True when the connected client advertised elicitation support. */
function clientSupportsElicitation(server: Server): boolean {
  const caps = server.getClientCapabilities() as ClientCaps | undefined;
  return caps?.elicitation !== undefined && caps.elicitation !== null;
}

/**
 * Would this tool need approval under policy for a typical invocation?
 * Conservative static check used for EXPOSURE decisions only; the runtime
 * still classifies and evaluates policy per call.
 */
export function toolNeedsApproval(toolkit: Toolkit, tool: ToolDefinition): boolean {
  const policy = toolkit._state.policy;
  const invocation = {
    sideEffect: tool.sideEffect,
    risk: tool.risk,
    capabilities: tool.capabilities.map((name) => ({ name }))
  };
  return approvalRuleFor(policy, tool.name, invocation).setting !== "never";
}

/** MCP elicitation approver: asks the client user directly (PRD 9.5). */
export function mcpElicitationApprover(server: Server): Approver {
  return {
    name: "mcp-elicitation",
    async approve(request: ApprovalRequest, context: { signal?: AbortSignal }) {
      if (!clientSupportsElicitation(server)) return null;
      try {
        const result = await server.elicitInput({
          message:
            `Approve ${request.tool.name}@${request.tool.version}?\n` +
            `Rule: ${request.rule}\n` +
            `Side effect: ${request.invocation.sideEffect} (risk: ${request.invocation.risk})\n` +
            `Input: ${request.inputPreview}`,
          requestedSchema: {
            type: "object",
            properties: {
              approve: { type: "boolean", description: "Allow this exact call" }
            },
            required: ["approve"]
          }
        }, { signal: context.signal });
        if (result.action !== "accept") {
          return { outcome: "deny", reason: `elicitation ${result.action}`, decidedBy: "mcp-elicitation" };
        }
        const content = (result as { content?: Record<string, unknown> }).content;
        return content?.approve === true
          ? { outcome: "allow", scope: "once", decidedBy: "mcp-elicitation" }
          : { outcome: "deny", reason: "not approved", decidedBy: "mcp-elicitation" };
      } catch {
        return null; // elicitation failed: fall through to other approvers
      }
    }
  };
}

/** Which tools this server exposes to the currently connected client. */
export function exposedTools(toolkit: Toolkit, server: Server | null): ToolDefinition[] {
  // An approver that prompts on stdio is NOT an out-of-band path here:
  // the stdio transport owns those streams, so it could never present a
  // request. Counting it would expose tools no one can approve.
  const hasOutOfBand = toolkit._state.approvers.some((a) => a.usesStdio !== true);
  const eliciting = server !== null && clientSupportsElicitation(server);
  return toolkit.listTools().filter((tool) => {
    if (!toolNeedsApproval(toolkit, tool)) return true;
    return eliciting || hasOutOfBand;
  });
}

function toMcpCallResult(result: ToolResult): {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
    ...(result.status === "error" ? { isError: true } : {})
  };
}

/**
 * Build an MCP Server for a toolkit without connecting a transport
 * (testable; serveMcp wires stdio on top).
 */
export function createMcpServer(toolkit: Toolkit, options: ServeMcpOptions = {}): Server {
  const server = new Server(
    { name: options.name ?? "agentic-tools", version: options.version ?? "0.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: exposedTools(toolkit, server).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
    const { name, arguments: args } = request.params;
    // Count the actual CallToolResult, including both copies and JSON escaping,
    // in the runtime before terminal audit/metrics, not after the invocation.
    const encodeResult = (result: ToolResult) => JSON.stringify(toMcpCallResult(result));
    // Server-level selection enforcement (PRD 8.6, FR-012/FR-019): a tool
    // not exposed to THIS client is rejected with permission_denied even
    // when the toolkit knows the name. Hiding the schema is never the
    // only control.
    const exposed = exposedTools(toolkit, server).some((t) => t.name === name);
    if (!exposed) {
      // Route even hidden/unknown calls through the runtime so denied calls
      // receive the same trace, audit, metrics, redaction and timing coverage.
      return toMcpCallResult(await toolkit.select({ name: [] }).invoke(name, args ?? {}, {
        signal: context.signal, encodeResult
      }));
    }
    // The elicitation approver goes first so the client user is asked
    // directly; toolkit approvers (CLI, queue, callback) are the fallback.
    const result = await toolkit.invoke(name, args ?? {}, {
      signal: context.signal, encodeResult,
      excludeStdioApprovers: true,
      extraApprovers: [mcpElicitationApprover(server)]
    });
    return toMcpCallResult(result);
  });

  return server;
}

/** Start an MCP server on stdio (PRD 10.1: stdio transport first). */
export async function serveMcp(toolkit: Toolkit, options: ServeMcpOptions = {}): Promise<Server> {
  const transport = options.transport ?? "stdio";
  if (transport !== "stdio") {
    throw new Error(`MCP transport "${String(transport)}" is not available at P0; only "stdio".`);
  }
  const server = createMcpServer(toolkit, options);
  await server.connect(new StdioServerTransport());
  return server;
}

export { serveMcpHttp } from "./http.js";
export type { McpHttpHandle, ServeMcpHttpOptions } from "./http.js";
