/**
 * @agentic-tools/bash — trusted-host shell execution (PRD 9.1, 9.3, 14.1).
 *
 * HONEST SCOPE (PRD principle 8): this package runs commands with HOST
 * PRIVILEGES and NO CONTAINMENT. It is not a sandbox and offers no
 * "restricted" mode: allowlists and argument filters are bypassable, so
 * they are not claimed as boundaries. Untrusted code requires an
 * OS/container sandbox backend (P1 roadmap). Every invocation classifies
 * as destructive/high unless it is a single simple invocation (no shell
 * operators, expansions or redirections) of an explicitly configured
 * named command, so the runtime approval-gates shell calls by default
 * (PRD 8.3). Network egress policy CANNOT be enforced here (PRD 7.1).
 *
 * ENVIRONMENT: the child receives a MINIMAL allowlisted environment
 * (PATH, HOME, TMPDIR/TEMP/TMP, LANG/LC_*, TERM, USER/LOGNAME, SHELL),
 * not the host process.env, so undeclared secrets in the host environment
 * do not flow into model-executed commands. Operators widen this only
 * through envAllowlist / env (explicit opt-in).
 */

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";
import {
  ToolError,
  defineTool,
  success,
  type InvocationClass,
  type SideEffect,
  type Risk,
  type ToolDefinition
} from "@agentic-tools/core";

/**
 * A pre-approved executable with honest classification (PRD 8.3).
 *
 * Matching is EXACT and STRUCTURAL, never substring or regex: the command
 * string must parse as one simple invocation (no `;`, `&&`, `|`, `>`,
 * `$`, backticks, subshells or escapes outside single quotes) whose first
 * word is exactly `command`. Anything else classifies destructive/high,
 * because a looser match would let `ls /tmp; rm -rf x` inherit the
 * classification of `ls`.
 */
export interface NamedCommand {
  /** Human-readable name shown in approval requests and audit. */
  name: string;
  /**
   * Exact executable name (bare name, no path). Arguments are not
   * matched; the configured sideEffect/risk must honestly cover every
   * argument shape of this executable. PATH resolution itself is a
   * trusted-host reality, not a boundary.
   */
  command: string;
  sideEffect: SideEffect;
  risk: Risk;
}

export interface BashOptions {
  /**
   * Required explicit opt-in. Only "trusted-host" exists at P0: host
   * privileges, no containment. There is no restricted mode.
   */
  mode: "trusted-host";
  /** Named commands with a narrower (never wider) classification. */
  namedCommands?: NamedCommand[];
  /** Per-invocation timeout ceiling in ms (default 120000). */
  maxTimeoutMs?: number;
  /** Per-stream output cap in bytes (default 65536). */
  maxOutputBytes?: number;
  /**
   * Extra host environment variable names to pass to the child, beyond
   * the minimal default allowlist. Explicit opt-in: never add names that
   * hold secrets the policy does not declare.
   */
  envAllowlist?: string[];
  /** Explicit environment variables to set (highest precedence). */
  env?: Record<string, string>;
}

const DEFAULT_MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

/** The minimal environment a shell child needs; nothing secret-bearing. */
const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "USER",
  "LOGNAME",
  "SHELL"
];

function buildChildEnv(options: BashOptions): Record<string, string> {
  const names = new Set([...DEFAULT_ENV_ALLOWLIST, ...(options.envAllowlist ?? [])]);
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    env[key] = value;
  }
  return env;
}

/**
 * Shell constructs that make a command ineligible for named-command
 * classification. Outside single quotes any of these means the string is
 * not a single simple invocation: `;` `&` `|` `<` `>` (compound, pipes,
 * redirection), `$` and backticks (expansion; `${x:-$(cmd)}` executes),
 * `\` (escapes hide intent), `()` `{}` (subshells/groups), newlines.
 */
const UNSAFE_OUTSIDE_QUOTES = new Set([
  ";",
  "&",
  "|",
  "<",
  ">",
  "$",
  "`",
  "\\",
  "(",
  ")",
  "{",
  "}",
  "\n",
  "\r"
]);

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * Parse a command string as ONE simple invocation. Returns the argv, or
 * null when the string uses any shell construct (operators, expansions,
 * redirections, unbalanced quotes). This is not a shell parser and never
 * claims compound safety: anything it cannot read as a single plain argv
 * fails closed to destructive/high.
 */
function simpleArgv(command: string): string[] | null {
  const argv: string[] = [];
  let current = "";
  let hasContent = false;
  let quote: "single" | "double" | null = null;
  const flush = () => {
    if (hasContent || current.length > 0) {
      argv.push(current);
      current = "";
      hasContent = false;
    }
  };
  for (const ch of command) {
    if (quote === "single") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === "double") {
      if (ch === '"') {
        quote = null;
        continue;
      }
      // Expansions still execute inside double quotes.
      if (ch === "$" || ch === "`" || ch === "\\") return null;
      current += ch;
      continue;
    }
    if (ch === "'") {
      quote = "single";
      hasContent = true;
      continue;
    }
    if (ch === '"') {
      quote = "double";
      hasContent = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      flush();
      continue;
    }
    if (UNSAFE_OUTSIDE_QUOTES.has(ch)) return null;
    current += ch;
  }
  if (quote !== null) return null;
  flush();
  return argv;
}

function classifyShell(command: string, named: NamedCommand[]): InvocationClass {
  const argv = simpleArgv(command);
  if (argv !== null && argv.length > 0) {
    const executable = argv[0] as string;
    const isBareName = !executable.includes("/") && !executable.includes("\\");
    // FOO=bar ls would smuggle env into the child; not eligible.
    if (isBareName && !ASSIGNMENT_PREFIX.test(executable)) {
      const hit = named.find((candidate) => candidate.command === executable);
      if (hit) {
        return {
          sideEffect: hit.sideEffect,
          risk: hit.risk,
          capabilities: [{ name: "process.execute", command: hit.name }]
        };
      }
    }
  }
  // Unknown, compound, expanding or path-addressed: fail closed.
  return {
    sideEffect: "destructive",
    risk: "high",
    capabilities: [{ name: "process.execute", command: "shell" }]
  };
}

function resolveCwd(workspace: string, cwd?: string): string {
  const root = realpathSync(workspace);
  const joined =
    cwd !== undefined && isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd ?? ".");
  const canonical = existsSync(joined) ? realpathSync(joined) : joined;
  if (canonical !== root && !canonical.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new ToolError(
      "permission_denied",
      `Working directory "${cwd ?? "."}" resolves outside the workspace root.`
    );
  }
  return canonical;
}

interface Captured {
  text: string;
  truncatedBytes: number;
}

function makeCollector(cap: number): { push(chunk: Buffer): void; done(): Captured } {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = 0;
  return {
    push(chunk: Buffer) {
      const room = cap - size;
      if (room > 0) {
        const kept = chunk.subarray(0, room);
        chunks.push(kept);
        size += kept.length;
        truncated += chunk.length - kept.length;
      } else {
        truncated += chunk.length;
      }
    },
    done(): Captured {
      return { text: Buffer.concat(chunks).toString("utf8"), truncatedBytes: truncated };
    }
  };
}

export function bash(options: BashOptions): ToolDefinition[] {
  if (options.mode !== "trusted-host") {
    throw new Error(
      'bash() requires { mode: "trusted-host" }: explicit opt-in to host-privilege, uncontained execution.'
    );
  }
  const named = options.namedCommands ?? [];
  const maxTimeoutMs = options.maxTimeoutMs ?? DEFAULT_MAX_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const childEnv = buildChildEnv(options);

  const tool = defineTool({
    name: "bash.execute",
    description:
      "Run a shell command on the HOST with full user privileges (trusted-host mode; NOT a sandbox). Approval-gated by default.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1 },
        cwd: { type: "string", description: "Working directory inside the workspace." },
        timeoutMs: { type: "integer", minimum: 1, description: `Ceiling ${maxTimeoutMs}.` }
      },
      required: ["command"],
      additionalProperties: false
    },
    sideEffect: "destructive",
    capabilities: ["process.execute"],
    risk: "high",
    tags: ["shell", "process"],
    classify: (input: { command: string }) => classifyShell(input.command, named),
    execute: async (input: { command: string; cwd?: string; timeoutMs?: number }, ctx) => {
      const cwd = resolveCwd(ctx.workspace, input.cwd);
      const timeoutMs = Math.min(input.timeoutMs ?? maxTimeoutMs, maxTimeoutMs);

      const result = await new Promise<{
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        timedOut: boolean;
        stdout: Captured;
        stderr: Captured;
      }>((resolvePromise, rejectPromise) => {
        const child = spawn("bash", ["-c", input.command], {
          cwd,
          detached: true, // own process group so the whole tree can be killed
          stdio: ["ignore", "pipe", "pipe"],
          env: childEnv
        });
        const stdout = makeCollector(maxOutputBytes);
        const stderr = makeCollector(maxOutputBytes);
        child.stdout.on("data", (c: Buffer) => stdout.push(c));
        child.stderr.on("data", (c: Buffer) => stderr.push(c));

        const killTree = () => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
          } catch {
            try {
              child.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          }
        };

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killTree();
        }, timeoutMs);
        const onAbort = () => {
          killTree();
        };
        ctx.signal.addEventListener("abort", onAbort, { once: true });

        child.on("error", (err) => {
          clearTimeout(timer);
          ctx.signal.removeEventListener("abort", onAbort);
          rejectPromise(err);
        });
        child.on("close", (exitCode, signal) => {
          clearTimeout(timer);
          ctx.signal.removeEventListener("abort", onAbort);
          resolvePromise({ exitCode, signal, timedOut, stdout: stdout.done(), stderr: stderr.done() });
        });
      });

      if (result.timedOut) {
        throw new ToolError("timeout", `Command timed out after ${timeoutMs}ms and was killed.`);
      }
      if (ctx.signal.aborted) {
        throw new ToolError("cancelled", "Command was cancelled and killed.");
      }
      const output = {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout.text,
        stderr: result.stderr.text
      };
      const truncatedBytes = result.stdout.truncatedBytes + result.stderr.truncatedBytes;
      const toolRef = { name: "bash.execute", version: "0.0.0" };
      if (truncatedBytes > 0) {
        return success(toolRef, output, {
          traceId: ctx.traceId,
          truncation: {
            truncated: true,
            unit: "bytes",
            omitted: truncatedBytes,
            continuation: `Output exceeded the per-stream cap of ${maxOutputBytes} bytes. Narrow the command or raise maxOutputBytes in bash() options.`
          }
        });
      }
      return success(toolRef, output, { traceId: ctx.traceId });
    }
  }) as ToolDefinition;

  return [tool];
}
