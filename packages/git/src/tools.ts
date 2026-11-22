/**
 * Git essential operations (PRD 13.4, 14.1).
 *
 * Default set is read-only: status, diff, log, branch (list). Write
 * operations (switch, add, reset, commit, branch create) are policy-gated
 * via the git.write capability and must be listed explicitly (PRD 8.6).
 * reset is limited to unstaging pathspecs; --hard is not offered.
 */

import { defineTool, type ToolDefinition } from "@agentic-tools/core";
import { assertSafePathspec, assertSafeRef, resolveRepo, runGit } from "./runner.js";

export const GIT_OPERATIONS = [
  "status",
  "diff",
  "log",
  "branch",
  "switch",
  "add",
  "reset",
  "commit"
] as const;
export type GitOperation = (typeof GIT_OPERATIONS)[number];

/** Minimal, read-only default set (PRD 8.6). */
export const GIT_DEFAULT_OPERATIONS: GitOperation[] = ["status", "diff", "log", "branch"];

const repoPath = { type: "string", description: "Repository directory, default the workspace root." } as const;

function readClassify(capability: string) {
  return (input: { path?: string }) => ({
    sideEffect: "read" as const,
    risk: "low" as const,
    capabilities: [{ name: capability, path: input.path ?? "." }]
  });
}

function writeClassify(input: { path?: string }) {
  return {
    sideEffect: "write" as const,
    risk: "medium" as const,
    capabilities: [{ name: "git.write", path: input.path ?? "." }]
  };
}

function createStatus(): ToolDefinition {
  return defineTool({
    name: "git.status",
    description: "Working tree status: current branch and changed files (porcelain).",
    inputSchema: {
      type: "object",
      properties: { path: repoPath },
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["git.read"],
    risk: "low",
    tags: ["git", "read"],
    classify: readClassify("git.read"),
    execute: async (input: { path?: string }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      const branch = (await runGit(ctx, repo, ["branch", "--show-current"])).stdout.trim();
      const porcelain = (await runGit(ctx, repo, ["status", "--porcelain=v1"])).stdout;
      const entries = porcelain
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => ({ path: l.slice(3), index: l[0], worktree: l[1] }));
      return { branch, clean: entries.length === 0, entries };
    }
  }) as ToolDefinition;
}

function createDiff(): ToolDefinition {
  return defineTool({
    name: "git.diff",
    description: "Show unstaged or staged changes, or a diff against a ref.",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        staged: { type: "boolean", description: "Diff the index instead of the worktree." },
        ref: { type: "string", description: "Diff against this ref." },
        pathspec: { type: "array", items: { type: "string" }, description: "Limit to these paths." }
      },
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["git.read"],
    risk: "low",
    tags: ["git", "read"],
    classify: readClassify("git.read"),
    execute: async (input: { path?: string; staged?: boolean; ref?: string; pathspec?: string[] }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      const args = ["diff"];
      if (input.staged) args.push("--cached");
      if (input.ref !== undefined) {
        assertSafeRef(input.ref);
        args.push(input.ref);
      }
      if (input.pathspec !== undefined && input.pathspec.length > 0) {
        args.push("--");
        for (const p of input.pathspec) args.push(assertSafePathspec(ctx.workspace, repo, p));
      }
      const { stdout } = await runGit(ctx, repo, args);
      return { diff: stdout, empty: stdout.trim().length === 0 };
    }
  }) as ToolDefinition;
}

function createLog(): ToolDefinition {
  return defineTool({
    name: "git.log",
    description: "Recent commits (sha, subject, author, date), newest first.",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        limit: { type: "integer", minimum: 1, maximum: 500, description: "Default 20." },
        ref: { type: "string" }
      },
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["git.read"],
    risk: "low",
    tags: ["git", "read"],
    classify: readClassify("git.read"),
    execute: async (input: { path?: string; limit?: number; ref?: string }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      const limit = input.limit ?? 20;
      const args = ["log", `--max-count=${limit}`, "--format=%H%x1f%s%x1f%an%x1f%aI"];
      if (input.ref !== undefined) {
        assertSafeRef(input.ref);
        args.push(input.ref);
      }
      const { stdout } = await runGit(ctx, repo, args);
      const commits = stdout
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => {
          const [sha, subject, author, date] = l.split("\x1f");
          return { sha, subject, author, date };
        });
      return { commits };
    }
  }) as ToolDefinition;
}

function createBranch(): ToolDefinition {
  return defineTool({
    name: "git.branch",
    description:
      "List branches (default), or create one when `create` is given. Deletion is not offered.",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        create: { type: "string", description: "Create a branch with this name (write)." },
        startPoint: { type: "string", description: "Start point for the new branch." }
      },
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["git.read", "git.write"],
    risk: "medium",
    tags: ["git"],
    classify: (input: { path?: string; create?: string }) =>
      input.create !== undefined
        ? {
            sideEffect: "write" as const,
            risk: "medium" as const,
            capabilities: [{ name: "git.write", path: input.path ?? "." }]
          }
        : {
            sideEffect: "read" as const,
            risk: "low" as const,
            capabilities: [{ name: "git.read", path: input.path ?? "." }]
          },
    execute: async (input: { path?: string; create?: string; startPoint?: string }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      if (input.create !== undefined) {
        assertSafeRef(input.create, "branch name");
        const args = ["branch", input.create];
        if (input.startPoint !== undefined) {
          assertSafeRef(input.startPoint, "start point");
          args.push(input.startPoint);
        }
        await runGit(ctx, repo, args);
        return { created: input.create };
      }
      const { stdout } = await runGit(ctx, repo, ["branch", "--format=%(refname:short)"]);
      const current = (await runGit(ctx, repo, ["branch", "--show-current"])).stdout.trim();
      const branches = stdout.split("\n").map((b) => b.trim()).filter((b) => b.length > 0);
      return { branches, current };
    }
  }) as ToolDefinition;
}

function createSwitch(): ToolDefinition {
  return defineTool({
    name: "git.switch",
    description: "Switch to a branch, optionally creating it first (write).",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        branch: { type: "string" },
        create: { type: "boolean", description: "Create the branch (git switch -c)." }
      },
      required: ["branch"],
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["git.write"],
    risk: "medium",
    tags: ["git", "write"],
    classify: writeClassify,
    execute: async (input: { path?: string; branch: string; create?: boolean }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      assertSafeRef(input.branch, "branch name");
      const args = ["switch"];
      if (input.create) args.push("-c");
      args.push(input.branch);
      await runGit(ctx, repo, args);
      return { switched: input.branch, created: input.create ?? false };
    }
  }) as ToolDefinition;
}

function createAdd(): ToolDefinition {
  return defineTool({
    name: "git.add",
    description: "Stage pathspecs (write).",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        pathspec: { type: "array", items: { type: "string" }, minItems: 1 }
      },
      required: ["pathspec"],
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["git.write"],
    risk: "medium",
    tags: ["git", "write"],
    classify: writeClassify,
    execute: async (input: { path?: string; pathspec: string[] }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      const args = ["add", "--"];
      for (const p of input.pathspec) args.push(assertSafePathspec(ctx.workspace, repo, p));
      await runGit(ctx, repo, args);
      return { staged: input.pathspec };
    }
  }) as ToolDefinition;
}

function createReset(): ToolDefinition {
  return defineTool({
    name: "git.reset",
    description: "Unstage pathspecs (write). --hard is not offered.",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        pathspec: { type: "array", items: { type: "string" }, minItems: 1 }
      },
      required: ["pathspec"],
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["git.write"],
    risk: "medium",
    tags: ["git", "write"],
    classify: writeClassify,
    execute: async (input: { path?: string; pathspec: string[] }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      const args = ["reset", "--"];
      for (const p of input.pathspec) args.push(assertSafePathspec(ctx.workspace, repo, p));
      await runGit(ctx, repo, args);
      return { unstaged: input.pathspec };
    }
  }) as ToolDefinition;
}

function createCommit(): ToolDefinition {
  return defineTool({
    name: "git.commit",
    description: "Commit staged changes with a message (write).",
    inputSchema: {
      type: "object",
      properties: {
        path: repoPath,
        message: { type: "string", minLength: 1 },
        allowEmpty: { type: "boolean" }
      },
      required: ["message"],
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["git.write"],
    risk: "medium",
    tags: ["git", "write"],
    classify: writeClassify,
    execute: async (input: { path?: string; message: string; allowEmpty?: boolean }, ctx) => {
      const repo = resolveRepo(ctx, input.path);
      const args = ["commit", "-m", input.message];
      if (input.allowEmpty) args.push("--allow-empty");
      await runGit(ctx, repo, args);
      const sha = (await runGit(ctx, repo, ["rev-parse", "HEAD"])).stdout.trim();
      return { sha, message: input.message };
    }
  }) as ToolDefinition;
}

const FACTORIES: Record<GitOperation, () => ToolDefinition> = {
  status: createStatus,
  diff: createDiff,
  log: createLog,
  branch: createBranch,
  switch: createSwitch,
  add: createAdd,
  reset: createReset,
  commit: createCommit
};

export interface GitOptions {
  /** Operations to expose. Default: status, diff, log, branch (read-only). */
  only?: GitOperation[];
  /** Operations to remove from the selected set. */
  except?: GitOperation[];
}

export function git(options: GitOptions = {}): ToolDefinition[] {
  let selected: GitOperation[];
  if (options.only !== undefined) {
    for (const op of options.only) {
      if (!GIT_OPERATIONS.includes(op)) {
        throw new Error(`Unknown git operation "${op}". Known: ${GIT_OPERATIONS.join(", ")}.`);
      }
    }
    selected = [...options.only];
  } else {
    selected = [...GIT_DEFAULT_OPERATIONS];
  }
  if (options.except !== undefined) {
    selected = selected.filter((op) => !options.except?.includes(op));
  }
  return selected.map((op) => FACTORIES[op]());
}
