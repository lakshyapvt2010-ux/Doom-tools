#!/usr/bin/env node
/**
 * agentic-tools CLI (FR-016, FR-018).
 *
 * Commands:
 *   doctor                          Platform capability detection.
 *   tools list --tokens             List exposed tools with token footprint.
 *   validate                        Validate a config module and print warnings.
 *   serve                           Start an MCP server (stdio) from a config.
 *   approvals list|approve|deny     Resolve file-queue approval requests.
 *
 * Output is readable without color (PRD 16 accessibility).
 */

import {
  listQueuedApprovals,
  writeQueuedDecision
} from "@agentic-tools/security";
import { serveMcp, serveMcpHttp } from "@agentic-tools/adapter-mcp";
import { loadToolkit, configWarnings } from "./config.js";
import { detectCapabilities, renderReport } from "./doctor.js";

const DEFAULT_CONFIG = "agentic-tools.config.mjs";
const DEFAULT_QUEUE_DIR = ".agentic-tools/approvals";

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else if (argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")) {
        flags.set(arg.slice(2), argv[i + 1] as string);
        i++;
      } else {
        flags.set(arg.slice(2), true);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function flagString(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
}

const USAGE = `agentic-tools <command> [options]

Commands:
  doctor                              Platform capability report (FR-018)
  tools list [--tokens]               Exposed tools and token footprint
  validate [--config FILE]            Validate a config module
  serve [--config FILE] [--name N]    Start the MCP server (stdio)
  serve --http [--host H] [--port N]  Start the MCP server over Streamable HTTP
                                      (loopback by default; set AGENTIC_TOOLS_MCP_TOKEN for a bearer token,
                                      required for a non-loopback host)
  approvals list [--queue DIR]        Pending approval requests
  approvals approve ID [--remember]   Allow a queued request
  approvals deny ID [--reason TEXT]   Deny a queued request

Config defaults to ./${DEFAULT_CONFIG}; queue defaults to ./${DEFAULT_QUEUE_DIR}.`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const [command, sub] = args.positional;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
      process.stdout.write(USAGE + "\n");
      return 0;

    case "doctor": {
      const report = detectCapabilities();
      process.stdout.write(renderReport(report) + "\n");
      return report.ok ? 0 : 1;
    }

    case "tools": {
      if (sub !== "list") {
        process.stderr.write(`Unknown tools subcommand "${sub ?? ""}".\n`);
        return 2;
      }
      const toolkit = await loadToolkit(flagString(args, "config") ?? DEFAULT_CONFIG);
      const withTokens = args.flags.has("tokens");
      const footprint = toolkit.describeFootprint();
      for (const tool of toolkit.listTools()) {
        const tokens = withTokens
          ? `  (~${footprint.perTool.find((p) => p.name === tool.name)?.tokens ?? 0} tokens)`
          : "";
        process.stdout.write(
          `${tool.name.padEnd(24)} ${tool.sideEffect.padEnd(11)} risk:${tool.risk}${tokens}\n    ${tool.description}\n`
        );
      }
      if (withTokens) {
        process.stdout.write(`Total footprint: ~${footprint.totalTokens} tokens\n`);
      }
      for (const w of configWarnings(toolkit)) process.stdout.write(`warning: ${w}\n`);
      return 0;
    }

    case "validate": {
      const toolkit = await loadToolkit(flagString(args, "config") ?? DEFAULT_CONFIG);
      const tools = toolkit.listTools();
      process.stdout.write(
        `Config OK. Workspace: ${toolkit.workspace}\nExposed tools: ${tools.length}\n`
      );
      const warnings = configWarnings(toolkit);
      for (const w of warnings) process.stdout.write(`warning: ${w}\n`);
      return warnings.length > 0 ? 0 : 0;
    }

    case "serve": {
      const toolkit = await loadToolkit(flagString(args, "config") ?? DEFAULT_CONFIG);
      for (const w of configWarnings(toolkit)) process.stderr.write(`warning: ${w}\n`);
      // Approvers that prompt on stdio (cliApprover) cannot present while
      // the stdio transport owns those streams; disable them for this
      // server so exposure decisions do not count them as out-of-band.
      if (args.flags.has("http")) {
        const token = process.env.AGENTIC_TOOLS_MCP_TOKEN;
        const portFlag = flagString(args, "port");
        if (portFlag !== undefined && !/^\d{1,5}$/.test(portFlag)) {
          process.stderr.write("error: --port must be a number\n");
          return 2;
        }
        const handle = await serveMcpHttp(toolkit, {
          name: flagString(args, "name") ?? "agentic-tools",
          host: flagString(args, "host") ?? "127.0.0.1",
          port: portFlag === undefined ? 0 : Number(portFlag),
          ...(token ? { authToken: token } : {})
        });
        process.stderr.write(
          `agentic-tools MCP server (Streamable HTTP) exposing ${toolkit.listTools().length} tools at ${handle.url}${token ? " (bearer token required)" : " (loopback only, no token)"}\n`
        );
        await new Promise<void>((resolvePromise) => {
          process.once("SIGINT", () => resolvePromise());
          process.once("SIGTERM", () => resolvePromise());
        });
        await handle.close();
        return 0;
      }
      const stdioApprovers = toolkit._state.approvers.filter((a) => a.usesStdio === true);
      if (stdioApprovers.length > 0) {
        toolkit._state.approvers = toolkit._state.approvers.filter((a) => a.usesStdio !== true);
        process.stderr.write(
          `warning: approver(s) ${stdioApprovers.map((a) => a.name).join(", ")} prompt on stdio and are disabled while serving MCP over stdio; use fileQueueApprover for out-of-band approvals.\n`
        );
      }
      process.stderr.write(
        `agentic-tools MCP server (stdio) exposing ${toolkit.listTools().length} tools\n`
      );
      await serveMcp(toolkit, { name: flagString(args, "name") ?? "agentic-tools" });
      // Keep the process alive serving stdio until the client disconnects.
      await new Promise<void>((resolvePromise) => {
        process.stdin.on("close", () => resolvePromise());
        process.stdin.on("end", () => resolvePromise());
      });
      return 0;
    }

    case "approvals": {
      const dir = flagString(args, "queue") ?? DEFAULT_QUEUE_DIR;
      if (sub === "list") {
        const pending = listQueuedApprovals(dir);
        if (pending.length === 0) {
          process.stdout.write("No pending approval requests.\n");
          return 0;
        }
        for (const r of pending) {
          process.stdout.write(
            `${r.id}\n  tool: ${r.tool.name}@${r.tool.version}\n  rule: ${r.rule}\n  input: ${r.inputPreview}\n  expires: ${new Date(r.expiresAt).toISOString()}\n`
          );
        }
        return 0;
      }
      if (sub === "approve" || sub === "deny") {
        const id = args.positional[2];
        if (id === undefined) {
          process.stderr.write(`approvals ${sub} needs a request ID.\n`);
          return 2;
        }
        const pending = listQueuedApprovals(dir).find((r) => r.id === id);
        if (!pending) {
          process.stderr.write(`No pending request ${id} in ${dir}.\n`);
          return 1;
        }
        writeQueuedDecision(dir, id, {
          outcome: sub === "approve" ? "allow" : "deny",
          scope: args.flags.has("remember") ? "remember" : "once",
          inputHash: pending.inputHash,
          decidedBy: "cli",
          ...(flagString(args, "reason") !== undefined
            ? { reason: flagString(args, "reason") as string }
            : {})
        });
        process.stdout.write(`${sub === "approve" ? "Approved" : "Denied"} ${id}.\n`);
        return 0;
      }
      process.stderr.write(`Unknown approvals subcommand "${sub ?? ""}".\n`);
      return 2;
    }

    default:
      process.stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
