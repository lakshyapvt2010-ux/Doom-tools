/**
 * Git CLI runner with workspace containment (PRD 13.4, 14.1).
 *
 * The git binary runs against a repository path that must resolve inside
 * the policy workspace. User-supplied refs and paths are validated so
 * they can never be interpreted as flags; pathspecs follow "--".
 */

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { ToolError, type ToolContext } from "@agentic-tools/core";

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

function canonicalize(target: string): string {
  let current = target;
  const remainder: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    remainder.unshift(basename(current));
    current = parent;
  }
  const realBase = existsSync(current) ? realpathSync(current) : current;
  return remainder.length > 0 ? join(realBase, ...remainder) : realBase;
}

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** Resolve a repository directory inside the workspace, or throw. */
export function resolveRepo(ctx: ToolContext, inputPath?: string): string {
  const joined =
    inputPath !== undefined && isAbsolute(inputPath)
      ? resolve(inputPath)
      : resolve(ctx.workspace, inputPath ?? ".");
  const canonical = canonicalize(joined);
  if (!isWithin(realpathSync(ctx.workspace), canonical)) {
    throw new ToolError(
      "permission_denied",
      `Repository path "${inputPath ?? "."}" resolves outside the workspace root.`
    );
  }
  return canonical;
}

const SAFE_REF = /^(?!-)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;

/** Refs and branch names must never be parsed as options. */
export function assertSafeRef(ref: string, what = "ref"): void {
  if (!SAFE_REF.test(ref) || ref.includes("..")) {
    throw new ToolError("validation", `Invalid ${what}: ${JSON.stringify(ref)}.`);
  }
}

/** Pathspecs are validated for containment and always follow "--". */
export function assertSafePathspec(workspaceRoot: string, repo: string, p: string): string {
  if (p.startsWith("-")) {
    throw new ToolError("validation", `Pathspec must not start with "-": ${JSON.stringify(p)}.`);
  }
  const joined = isAbsolute(p) ? resolve(p) : resolve(repo, p);
  const canonical = canonicalize(joined);
  if (!isWithin(realpathSync(workspaceRoot), canonical)) {
    throw new ToolError("permission_denied", `Pathspec "${p}" resolves outside the workspace.`);
  }
  return p;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runGit(ctx: ToolContext, repo: string, args: string[]): Promise<GitResult> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      ["-C", repo, ...args],
      {
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          reject(new ToolError("timeout", `git ${args[0] ?? ""} timed out.`));
          return;
        }
        const exitCode =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code)
            : 0;
        if (exitCode !== 0) {
          reject(
            new ToolError(
              "execution_error",
              `git ${args[0] ?? ""} failed (exit ${exitCode}): ${String(stderr).slice(0, 500)}`
            )
          );
          return;
        }
        resolvePromise({ stdout: String(stdout), stderr: String(stderr), exitCode });
      }
    );
  });
}
