/**
 * Pluggable approvers (PRD 9.5).
 *
 * P0 ships: an in-process callback approver, a CLI prompt approver and a
 * file-queue approver for non-interactive/remote agents (decisions are
 * written by `agentic-tools approvals approve|deny`). MCP elicitation is
 * provided by @agentic-tools/adapter-mcp where the client supports it.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import type { Approver, ApprovalDecision, ApprovalRequest } from "./approvals.js";

/** In-process callback approver: the host application decides. */
export function callbackApprover(
  fn: (request: ApprovalRequest) => Promise<ApprovalDecision | null> | ApprovalDecision | null,
  name = "callback"
): Approver {
  return {
    name,
    approve: async (request) => fn(request)
  };
}

/** Approve everything. For tests and explicitly trusted automation only. */
export function allowAllApprover(): Approver {
  return {
    name: "allow-all",
    approve: async () => ({ outcome: "allow", scope: "once", decidedBy: "allow-all" })
  };
}

/** Deny everything (still counts as an available approver). */
export function denyAllApprover(): Approver {
  return {
    name: "deny-all",
    approve: async () => ({ outcome: "deny", decidedBy: "deny-all" })
  };
}

/**
 * Interactive CLI prompt approver. Prints the redacted preview and asks
 * for y (allow once), a (allow and remember, where policy permits) or n.
 */
export function cliApprover(options: { input?: NodeJS.ReadStream; output?: NodeJS.WriteStream } = {}): Approver {
  return {
    name: "cli",
    // Prompting claims stdin/stdout. A transport that owns those streams
    // (the MCP stdio server) must not count this as an out-of-band path.
    usesStdio: true,
    async approve(request) {
      const input = options.input ?? process.stdin;
      const output = options.output ?? process.stdout;
      if (!input.isTTY) return null; // non-interactive: cannot present
      const rl = createInterface({ input, output });
      try {
        output.write(
          [
            "",
            `Approval required (${request.id})`,
            `  tool:       ${request.tool.name}@${request.tool.version}`,
            `  rule:       ${request.rule}`,
            `  side effect: ${request.invocation.sideEffect} (risk: ${request.invocation.risk})`,
            `  input:      ${request.inputPreview}`,
            `  expires:    ${new Date(request.expiresAt).toISOString()}`,
            ""
          ].join("\n")
        );
        const answer = await rl.question("Approve? [y]es once / [a]lways this exact input / [n]o: ");
        const a = answer.trim().toLowerCase();
        if (a === "y" || a === "yes") {
          return { outcome: "allow", scope: "once", decidedBy: "cli" };
        }
        if (a === "a" || a === "always") {
          return { outcome: "allow", scope: "remember", decidedBy: "cli" };
        }
        return { outcome: "deny", reason: "declined at CLI", decidedBy: "cli" };
      } finally {
        rl.close();
      }
    }
  };
}

/**
 * File-queue approver for non-interactive and remote agents (PRD 9.5
 * webhook/queue family). Requests are dropped as JSON files into
 * `<dir>/pending/`; an operator resolves them by writing a decision file
 * (the CLI's `approvals approve|deny` commands do this). The approver
 * polls for the decision until the request expires.
 */
export function fileQueueApprover(options: { dir: string; pollMs?: number }): Approver {
  const pendingDir = join(options.dir, "pending");
  const decisionsDir = join(options.dir, "decisions");
  const pollMs = options.pollMs ?? 1000;
  return {
    name: "file-queue",
    async approve(request, context) {
      mkdirSync(pendingDir, { recursive: true });
      mkdirSync(decisionsDir, { recursive: true });
      writeFileSync(
        join(pendingDir, `${request.id}.json`),
        JSON.stringify(request, null, 2),
        "utf8"
      );
      const decisionPath = join(decisionsDir, `${request.id}.json`);
      const msLeft = request.expiresAt - Date.now();
      const deadline = Date.now() + Math.max(0, msLeft);
      while (Date.now() < deadline) {
        if (context.signal?.aborted) return null;
        if (existsSync(decisionPath)) {
          let raw: unknown;
          try {
            raw = JSON.parse(readFileSync(decisionPath, "utf8"));
          } catch {
            // Possibly a partially written file: keep polling until the
            // request expires. An unreadable decision never approves.
            await new Promise((r) => setTimeout(r, pollMs));
            continue;
          }
          const decision = (raw ?? {}) as ApprovalDecision & { inputHash?: unknown };
          // Bind the decision to the exact classified input (PRD 9.5).
          // The binding is REQUIRED: a decision without a matching
          // inputHash is malformed and fails closed (deny), never allow.
          if (typeof decision.inputHash !== "string" || decision.inputHash !== request.inputHash) {
            return {
              outcome: "deny",
              reason: "decision missing the required inputHash binding or bound to a different input",
              decidedBy: "file-queue"
            };
          }
          if (decision.outcome !== "allow" && decision.outcome !== "deny") {
            return { outcome: "deny", reason: "malformed decision outcome", decidedBy: "file-queue" };
          }
          return {
            outcome: decision.outcome,
            scope: decision.scope === "remember" ? "remember" : "once",
            ...(typeof decision.reason === "string" ? { reason: decision.reason } : {}),
            decidedBy: typeof decision.decidedBy === "string" ? decision.decidedBy : "file-queue"
          };
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      return null; // expired
    }
  };
}

/** List pending request files in a queue directory (used by the CLI). */
export function listQueuedApprovals(dir: string): ApprovalRequest[] {
  const pendingDir = join(dir, "pending");
  if (!existsSync(pendingDir)) return [];
  const out: ApprovalRequest[] = [];
  for (const file of readdirSync(pendingDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(pendingDir, file), "utf8")) as ApprovalRequest);
    } catch {
      // skip unreadable entries
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

/** Write a decision for a queued request (used by the CLI). */
export function writeQueuedDecision(
  dir: string,
  requestId: string,
  decision: ApprovalDecision & { inputHash?: string }
): void {
  const decisionsDir = join(dir, "decisions");
  mkdirSync(decisionsDir, { recursive: true });
  writeFileSync(join(decisionsDir, `${requestId}.json`), JSON.stringify(decision, null, 2), "utf8");
}
