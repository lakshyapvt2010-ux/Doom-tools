import { execFile } from "node:child_process";
import { devNull } from "node:os";
import { existsSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolError, type ToolContext } from "@agentic-tools/core";

const GIT_TIMEOUT_MS = 30_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;
function canonicalize(target: string, depth = 0): string {
  if (depth > 40) throw new Error("Too many symlink resolutions.");
  let current = target;
  const remainder: string[] = [];
  while (!existsSync(current)) {
    // existsSync follows links and is false for a dangling link. lstat
    // still sees that link, which must be resolved BEFORE appending the
    // missing tail or a write could follow it outside the workspace.
    try {
      if (lstatSync(current).isSymbolicLink()) {
        const destination = resolve(dirname(current), readlinkSync(current));
        return join(canonicalize(destination, depth + 1), ...remainder);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" &&
          (error as NodeJS.ErrnoException).code !== "ENOTDIR") throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    remainder.unshift(basename(current));
    current = parent;
  }
  const base = existsSync(current) ? realpathSync(current) : current;
  return remainder.length ? join(base, ...remainder) : base;
}

function isWithin(root: string, candidate: string): boolean {
  // Native relative handles Windows drive-letter/case normalization without
  // confusing sibling prefixes or allowing a different drive.
  const suffix = relative(root, candidate);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(".." + sep));
}
export function resolveRepo(ctx: ToolContext, inputPath?: string): string {
  const target = inputPath !== undefined && isAbsolute(inputPath)
    ? resolve(inputPath) : resolve(ctx.workspace, inputPath ?? ".");
  const canonical = canonicalize(target);
  if (!isWithin(realpathSync(ctx.workspace), canonical)) {
    throw new ToolError("permission_denied", `Repository path "${inputPath ?? "."}" resolves outside the workspace root.`);
  }
  return canonical;
}
const SAFE_REF = /^(?!-)[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
export function assertSafeRef(ref: string, what = "ref"): void {
  if (!SAFE_REF.test(ref) || ref.includes("..")) throw new ToolError("validation", `Invalid ${what}: ${JSON.stringify(ref)}.`);
}
export function assertSafePathspec(workspaceRoot: string, repo: string, path: string): string {
  if (path.startsWith("-")) throw new ToolError("validation", `Pathspec must not start with "-": ${JSON.stringify(path)}.`);
  const target = isAbsolute(path) ? resolve(path) : resolve(repo, path);
  if (!isWithin(realpathSync(workspaceRoot), canonicalize(target))) {
    throw new ToolError("permission_denied", `Pathspec "${path}" resolves outside the workspace.`);
  }
  return path;
}
export interface GitResult { stdout: string; stderr: string; exitCode: number; }

/** Git is a host binary, not an isolation boundary. Do not inherit GIT_DIR,
 * GIT_WORK_TREE or secret-bearing environment variables from the host. Hooks,
 * pagers and filesystem monitors are disabled because tool permission to run
 * Git is not permission to execute arbitrary repository-configured programs. */
function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TMP", "TEMP",
    "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE",
    "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat" };
}
async function executeGit(ctx: ToolContext, repo: string, args: string[]): Promise<GitResult> {
  if (ctx.signal.aborted) throw new ToolError("cancelled", "Git invocation cancelled.");
  const remaining = ctx.deadline === undefined ? GIT_TIMEOUT_MS : ctx.deadline - Date.now();
  if (remaining <= 0) throw new ToolError("timeout", "Git invocation deadline expired.");
  return new Promise((resolvePromise, reject) => {
    execFile("git", ["-c", `core.hooksPath=${devNull}`, "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", "-C", repo, ...args], {
      timeout: Math.min(GIT_TIMEOUT_MS, remaining), maxBuffer: GIT_MAX_BUFFER,
      signal: ctx.signal, encoding: "utf8", env: gitEnvironment()
    }, (error, stdout, stderr) => {
      if (ctx.signal.aborted) { reject(new ToolError("cancelled", "Git invocation cancelled.")); return; }
      if (error && (error as { killed?: boolean }).killed) { reject(new ToolError("timeout", `git ${args[0]} timed out.`)); return; }
      if (error) {
        reject(new ToolError("execution_error", `git ${args[0]} failed: ${String(stderr).slice(0, 500) || "Git could not start."}`));
        return;
      }
      resolvePromise({ stdout: String(stdout), stderr: String(stderr), exitCode: 0 });
    });
  });
}
export async function runGit(ctx: ToolContext, repo: string, args: string[]): Promise<GitResult> {
  // `git -C child` otherwise discovers an enclosing repository outside the
  // workspace and can commit unrelated staged files. Check Git's actual root.
  const discovery = await executeGit(ctx, repo, ["rev-parse", "--show-toplevel"]);
  // Git for Windows prints forward slashes; normalize before realpath so the
  // containment check compares native separators rather than rejecting the repo.
  const root = canonicalize(resolve(discovery.stdout.replace(/\r?\n$/, "")));
  if (!isWithin(realpathSync(ctx.workspace), root)) {
    throw new ToolError("permission_denied", "Git discovered a repository root outside the configured workspace. Choose the repository root as the workspace explicitly.");
  }
  return executeGit(ctx, repo, args);
}
