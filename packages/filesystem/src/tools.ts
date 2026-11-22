/**
 * Workspace-scoped filesystem tools (PRD 13.2, 14.1; FR-007, FR-022).
 *
 * Default operation set is minimal and read-only: read, list, search,
 * grep, diff. Write and edit are never in the default set and must be
 * listed explicitly (PRD 8.6). Every path is resolved inside the
 * workspace root from the runtime context (PRD 7.1); a factory-level
 * root may only narrow it.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, sep } from "node:path";
import { Worker } from "node:worker_threads";
import {
  ToolError,
  defineTool,
  success,
  type ToolContext,
  type ToolDefinition
} from "@agentic-tools/core";
import { resolveWithin } from "./paths.js";
import { globToRegExp } from "./glob.js";
import { diffLines, hasChanges, renderUnified } from "./ldiff.js";
import type { GrepJob, GrepMatch } from "./grep-worker.js";

export const FILESYSTEM_OPERATIONS = [
  "read",
  "list",
  "search",
  "grep",
  "diff",
  "write",
  "edit"
] as const;
export type FilesystemOperation = (typeof FILESYSTEM_OPERATIONS)[number];

/** Minimal, read-only default set (PRD 8.6). */
export const FILESYSTEM_DEFAULT_OPERATIONS: FilesystemOperation[] = [
  "read",
  "list",
  "search",
  "grep",
  "diff"
];

const DEFAULT_READ_BYTES = 64 * 1024;
const DEFAULT_PAGE = 200;
const MAX_PAGE = 2000;
const MAX_WALK_FILES = 50_000;
const MAX_GREP_LINE = 2048;
/** Defense in depth alongside the isolated scanner (never the fix alone). */
const MAX_GREP_PATTERN = 500;
const MAX_GREP_FILE_BYTES = 16 * 1024 * 1024;
/**
 * Run the regex scan in a worker thread with a hard wall-clock bound. A
 * catastrophically backtracking pattern cannot block the host event loop
 * or defeat the runtime timeout: the worker is terminated on expiry or
 * cancellation. The bound comes from the invocation deadline.
 */
function runGrepScan(job: GrepJob, ctx: ToolContext): Promise<GrepMatch[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    const remaining =
      typeof ctx.deadline === "number" && Number.isFinite(ctx.deadline)
        ? ctx.deadline - Date.now() - 50
        : 30_000;
    const budgetMs = Math.max(250, Math.min(remaining, 30_000));
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(new URL("./grep-worker.js", import.meta.url), { workerData: job });
    } catch (err) {
      rejectPromise(err);
      return;
    }
    const finish = (err: Error | null, matches?: GrepMatch[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      void worker.terminate();
      if (err) rejectPromise(err);
      else resolvePromise(matches ?? []);
    };
    const timer = setTimeout(() => {
      finish(
        new ToolError(
          "timeout",
          `grep scan exceeded its ${budgetMs}ms budget and was terminated. Narrow the pattern or path.`
        )
      );
    }, budgetMs);
    const onAbort = () => {
      finish(new ToolError("cancelled", "grep scan was cancelled and terminated."));
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (msg: { matches: GrepMatch[] }) => finish(null, msg.matches));
    worker.once("error", (err) => finish(err));
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(new ToolError("execution_error", `grep scanner exited with code ${code}.`));
      }
    });
  });
}
const SKIP_DIRS = new Set([".git", "node_modules"]);

interface PageCursor {
  i: number;
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: unknown): PageCursor {
  if (raw === undefined || raw === null) return { i: 0 };
  if (typeof raw !== "string") throw new ToolError("validation", "cursor must be a string.");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as PageCursor;
    if (typeof parsed.i !== "number" || parsed.i < 0) throw new Error("bad");
    return parsed;
  } catch {
    throw new ToolError("validation", "cursor is not valid for this listing.");
  }
}

function pageLimit(raw: unknown): number {
  if (raw === undefined) return DEFAULT_PAGE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE) {
    throw new ToolError("validation", `limit must be an integer 1..${MAX_PAGE}.`);
  }
  return n;
}

/** Effective root: the policy workspace, optionally narrowed by the factory root. */
function effectiveRoot(ctx: ToolContext, factoryRoot?: string): string {
  if (factoryRoot === undefined) return ctx.workspace;
  return resolveWithin(ctx.workspace, factoryRoot).absolute;
}

function classifyFs(name: string, se: "read" | "write", risk: "low" | "medium") {
  return (input: { path?: string }) => ({
    sideEffect: se,
    risk,
    capabilities: [{ name, path: typeof input.path === "string" ? input.path : "." }]
  });
}

function createReadTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.read",
    description:
      "Read a UTF-8 text file from the workspace. Large files are truncated with byte offset/limit pagination.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        offset: { type: "integer", minimum: 0, description: "Byte offset to start at." },
        limit: { type: "integer", minimum: 1, description: `Max bytes (default ${DEFAULT_READ_BYTES}).` }
      },
      required: ["path"],
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["filesystem.read"],
    risk: "low",
    tags: ["filesystem", "read"],
    classify: classifyFs("filesystem.read", "read", "low"),
    execute: async (input: { path: string; offset?: number; limit?: number }, ctx) => {
      const { absolute, relative } = resolveWithin(effectiveRoot(ctx, factoryRoot), input.path);
      if (!existsSync(absolute)) {
        throw new ToolError("not_found", `No such file: "${input.path}".`);
      }
      const stat = statSync(absolute);
      if (!stat.isFile()) {
        throw new ToolError("validation", `"${input.path}" is not a regular file.`);
      }
      const offset = input.offset ?? 0;
      const limit = input.limit ?? DEFAULT_READ_BYTES;
      const buf = readFileSync(absolute);
      const slice = buf.subarray(offset, offset + limit);
      const content = slice.toString("utf8");
      const omitted = buf.length - offset - slice.length;
      const output = {
        path: relative,
        content,
        sizeBytes: buf.length,
        offset,
        returnedBytes: slice.length
      };
      const toolRef = { name: "filesystem.read", version: "0.0.0" };
      if (omitted > 0) {
        return success(toolRef, output, {
          traceId: ctx.traceId,
          truncation: {
            truncated: true,
            unit: "bytes",
            omitted,
            continuation: `Re-invoke with offset ${offset + slice.length} to continue.`
          }
        });
      }
      return success(toolRef, output, { traceId: ctx.traceId });
    }
  }) as ToolDefinition;
}

function createListTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.list",
    description: "List directory entries (name, type, size) with cursor pagination.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory, default the workspace root." },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_PAGE }
      },
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["filesystem.read"],
    risk: "low",
    tags: ["filesystem", "read"],
    classify: classifyFs("filesystem.read", "read", "low"),
    execute: async (input: { path?: string; cursor?: string; limit?: number }, ctx) => {
      const { absolute, relative } = resolveWithin(effectiveRoot(ctx, factoryRoot), input.path ?? ".");
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        throw new ToolError("not_found", `No such directory: "${input.path ?? "."}".`);
      }
      const entries = readdirSync(absolute, { withFileTypes: true })
        .map((d) => {
          let sizeBytes: number | null = null;
          try {
            sizeBytes = statSync(join(absolute, d.name)).size;
          } catch {
            sizeBytes = null;
          }
          return {
            name: d.name,
            type: d.isDirectory() ? ("directory" as const) : d.isSymbolicLink() ? ("symlink" as const) : ("file" as const),
            sizeBytes
          };
        })
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const limit = pageLimit(input.limit);
      const start = decodeCursor(input.cursor).i;
      const items = entries.slice(start, start + limit);
      const nextIndex = start + items.length;
      return {
        path: relative,
        items,
        totalEntries: entries.length,
        ...(nextIndex < entries.length ? { nextCursor: encodeCursor({ i: nextIndex }) } : {})
      };
    }
  }) as ToolDefinition;
}

interface WalkEntry {
  relative: string;
  absolute: string;
  isDirectory: boolean;
}

function walk(
  root: string,
  options: { includeIgnored?: boolean; dirs?: boolean }
): WalkEntry[] {
  const out: WalkEntry[] = [];
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < MAX_WALK_FILES) {
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      const rel = abs.slice(root.length).replace(new RegExp(`^\\${sep}`), "").split(sep).join("/");
      if (entry.isDirectory()) {
        if (!options.includeIgnored && SKIP_DIRS.has(entry.name)) continue;
        if (options.dirs) out.push({ relative: rel, absolute: abs, isDirectory: true });
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push({ relative: rel, absolute: abs, isDirectory: false });
      }
      // symlinks are not followed during walks (containment, FR-007)
      if (out.length >= MAX_WALK_FILES) break;
    }
  }
  out.sort((a, b) => (a.relative < b.relative ? -1 : 1));
  return out;
}

function createSearchTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.search",
    description:
      "Find files by glob pattern (supports **, *, ?) under the workspace, with cursor pagination.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern, e.g. \"src/**/*.ts\"." },
        path: { type: "string", description: "Subdirectory to search, default the root." },
        includeIgnored: { type: "boolean", description: "Also descend into .git/node_modules." },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_PAGE }
      },
      required: ["pattern"],
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["filesystem.read"],
    risk: "low",
    tags: ["filesystem", "read", "search"],
    classify: classifyFs("filesystem.read", "read", "low"),
    execute: async (
      input: { pattern: string; path?: string; includeIgnored?: boolean; cursor?: string; limit?: number },
      ctx
    ) => {
      const base = resolveWithin(effectiveRoot(ctx, factoryRoot), input.path ?? ".");
      if (!existsSync(base.absolute) || !statSync(base.absolute).isDirectory()) {
        throw new ToolError("not_found", `No such directory: "${input.path ?? "."}".`);
      }
      const matcher = globToRegExp(input.pattern);
      const all = walk(base.absolute, { includeIgnored: input.includeIgnored ?? false })
        .map((e) => joinPathPrefix(base.relative, e.relative))
        .filter((rel) => matcher.test(rel) || matcher.test(rel.split("/").pop() ?? rel));
      const limit = pageLimit(input.limit);
      const start = decodeCursor(input.cursor).i;
      const items = all.slice(start, start + limit);
      const nextIndex = start + items.length;
      return {
        items,
        totalMatches: all.length,
        ...(nextIndex < all.length ? { nextCursor: encodeCursor({ i: nextIndex }) } : {})
      };
    }
  }) as ToolDefinition;
}

function joinPathPrefix(prefix: string, rel: string): string {
  if (prefix === "." || prefix === "") return rel;
  return `${prefix.split(sep).join("/")}/${rel}`;
}

function createGrepTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.grep",
    description:
      "Search file contents with a regular expression; returns matching lines with cursor pagination.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "JavaScript regular expression." },
        path: { type: "string", description: "Subdirectory, default the root." },
        glob: { type: "string", description: "Restrict to files matching this glob." },
        ignoreCase: { type: "boolean" },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_PAGE }
      },
      required: ["pattern"],
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["filesystem.read"],
    risk: "low",
    tags: ["filesystem", "read", "search"],
    classify: classifyFs("filesystem.read", "read", "low"),
    execute: async (
      input: { pattern: string; path?: string; glob?: string; ignoreCase?: boolean; cursor?: string; limit?: number },
      ctx
    ) => {
      if (input.pattern.length > MAX_GREP_PATTERN) {
        throw new ToolError(
          "validation",
          `pattern exceeds the ${MAX_GREP_PATTERN}-character limit.`
        );
      }
      try {
        new RegExp(input.pattern, input.ignoreCase ? "i" : "");
      } catch (err) {
        throw new ToolError("validation", `Invalid regular expression: ${(err as Error).message}`);
      }
      const base = resolveWithin(effectiveRoot(ctx, factoryRoot), input.path ?? ".");
      if (!existsSync(base.absolute)) {
        throw new ToolError("not_found", `No such path: "${input.path ?? "."}".`);
      }
      const fileMatcher = input.glob !== undefined ? globToRegExp(input.glob) : null;
      const files = statSync(base.absolute).isFile()
        ? [{ relative: base.relative, absolute: base.absolute, isDirectory: false }]
        : walk(base.absolute, {}).filter((e) => !e.isDirectory);
      // Collect candidate lines here; the REGEX SCAN runs in an isolated
      // worker thread (runGrepScan) so a catastrophic pattern cannot
      // block the event loop or defeat the invocation deadline.
      const job: GrepJob = { pattern: input.pattern, ignoreCase: input.ignoreCase === true, files: [] };
      for (const file of files) {
        const displayPath = statSync(base.absolute).isFile()
          ? base.relative
          : joinPathPrefix(base.relative, file.relative);
        if (fileMatcher && !fileMatcher.test(displayPath) && !fileMatcher.test(file.relative)) {
          continue;
        }
        let text: string;
        try {
          const stat = statSync(file.absolute);
          if (stat.size > MAX_GREP_FILE_BYTES) continue; // skip very large files
          const buf = readFileSync(file.absolute);
          if (buf.includes(0)) continue; // skip binary files
          text = buf.toString("utf8");
        } catch {
          continue;
        }
        job.files.push({
          path: displayPath,
          lines: text.split("\n").map((line) => line.slice(0, MAX_GREP_LINE))
        });
      }
      const matches = await runGrepScan(job, ctx);
      const limit = pageLimit(input.limit);
      const start = decodeCursor(input.cursor).i;
      const items = matches.slice(start, start + limit);
      const nextIndex = start + items.length;
      return {
        items,
        totalMatches: matches.length,
        ...(nextIndex < matches.length ? { nextCursor: encodeCursor({ i: nextIndex }) } : {})
      };
    }
  }) as ToolDefinition;
}

function createDiffTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.diff",
    description: "Unified line diff between two files in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        pathA: { type: "string" },
        pathB: { type: "string" }
      },
      required: ["pathA", "pathB"],
      additionalProperties: false
    },
    sideEffect: "read",
    capabilities: ["filesystem.read"],
    risk: "low",
    tags: ["filesystem", "read"],
    classify: (input: { pathA?: string; pathB?: string }) => ({
      sideEffect: "read" as const,
      risk: "low" as const,
      capabilities: [
        { name: "filesystem.read", path: input.pathA ?? "." },
        { name: "filesystem.read", path: input.pathB ?? "." }
      ]
    }),
    execute: async (input: { pathA: string; pathB: string }, ctx) => {
      const root = effectiveRoot(ctx, factoryRoot);
      const a = resolveWithin(root, input.pathA);
      const b = resolveWithin(root, input.pathB);
      for (const [label, p] of [["pathA", a], ["pathB", b]] as const) {
        if (!existsSync(p.absolute)) {
          throw new ToolError("not_found", `No such file for ${label}: "${p.relative}".`);
        }
      }
      let lines;
      try {
        lines = diffLines(readFileSync(a.absolute, "utf8"), readFileSync(b.absolute, "utf8"));
      } catch (err) {
        throw new ToolError("resource_limit", (err as Error).message);
      }
      return {
        pathA: a.relative,
        pathB: b.relative,
        changed: hasChanges(lines),
        unified: renderUnified(lines, a.relative, b.relative)
      };
    }
  }) as ToolDefinition;
}

function createWriteTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.write",
    description:
      "Write a UTF-8 file inside the workspace (creates parents on request). Not in the default operation set.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        createParents: { type: "boolean", description: "Create missing parent directories." }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["filesystem.write"],
    risk: "medium",
    tags: ["filesystem", "write"],
    classify: classifyFs("filesystem.write", "write", "medium"),
    execute: async (input: { path: string; content: string; createParents?: boolean }, ctx) => {
      const { absolute, relative } = resolveWithin(effectiveRoot(ctx, factoryRoot), input.path);
      const parent = dirname(absolute);
      if (!existsSync(parent)) {
        if (input.createParents) {
          mkdirSync(parent, { recursive: true });
        } else {
          throw new ToolError("not_found", `Directory does not exist: "${dirname(relative)}". Set createParents to create it.`);
        }
      }
      const buf = Buffer.from(input.content, "utf8");
      writeFileSync(absolute, buf);
      return { path: relative, bytesWritten: buf.length };
    }
  }) as ToolDefinition;
}

function createEditTool(factoryRoot?: string): ToolDefinition {
  return defineTool({
    name: "filesystem.edit",
    description:
      "Apply exact find/replace edits to a text file in the workspace. Not in the default operation set.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              find: { type: "string" },
              replace: { type: "string" },
              all: { type: "boolean", description: "Replace every occurrence (default false: exactly one required)." }
            },
            required: ["find", "replace"],
            additionalProperties: false
          },
          minItems: 1
        }
      },
      required: ["path", "edits"],
      additionalProperties: false
    },
    sideEffect: "write",
    capabilities: ["filesystem.write"],
    risk: "medium",
    tags: ["filesystem", "write"],
    classify: classifyFs("filesystem.write", "write", "medium"),
    execute: async (
      input: { path: string; edits: { find: string; replace: string; all?: boolean }[] },
      ctx
    ) => {
      const { absolute, relative } = resolveWithin(effectiveRoot(ctx, factoryRoot), input.path);
      if (!existsSync(absolute)) {
        throw new ToolError("not_found", `No such file: "${input.path}".`);
      }
      let content = readFileSync(absolute, "utf8");
      let replacements = 0;
      for (const edit of input.edits) {
        if (edit.find === "") throw new ToolError("validation", "edit.find must not be empty.");
        const occurrences = content.split(edit.find).length - 1;
        if (occurrences === 0) {
          throw new ToolError("not_found", `Edit target not found in "${relative}": ${JSON.stringify(edit.find.slice(0, 80))}`);
        }
        if (!edit.all && occurrences > 1) {
          throw new ToolError(
            "conflict",
            `Edit target occurs ${occurrences} times in "${relative}"; set all: true or make it unique.`
          );
        }
        content = content.split(edit.find).join(edit.replace);
        replacements += edit.all ? occurrences : 1;
      }
      writeFileSync(absolute, content, "utf8");
      return { path: relative, replacements, sizeBytes: Buffer.byteLength(content, "utf8") };
    }
  }) as ToolDefinition;
}

const FACTORIES: Record<FilesystemOperation, (root?: string) => ToolDefinition> = {
  read: createReadTool,
  list: createListTool,
  search: createSearchTool,
  grep: createGrepTool,
  diff: createDiffTool,
  write: createWriteTool,
  edit: createEditTool
};

export interface FilesystemOptions {
  /**
   * Narrow the boundary below the policy workspace (may never widen it,
   * PRD 7.1). Resolved against the toolkit workspace at execution time.
   */
  root?: string;
  /** Operations to expose. Default: the read-only default set (PRD 8.6). */
  only?: FilesystemOperation[];
  /** Operations to remove from the selected set. */
  except?: FilesystemOperation[];
}

export function filesystem(options: FilesystemOptions = {}): ToolDefinition[] {
  let selected: FilesystemOperation[];
  if (options.only !== undefined) {
    for (const op of options.only) {
      if (!FILESYSTEM_OPERATIONS.includes(op)) {
        throw new Error(`Unknown filesystem operation "${op}". Known: ${FILESYSTEM_OPERATIONS.join(", ")}.`);
      }
    }
    selected = [...options.only];
  } else {
    selected = [...FILESYSTEM_DEFAULT_OPERATIONS];
  }
  if (options.except !== undefined) {
    selected = selected.filter((op) => !options.except?.includes(op));
  }
  return selected.map((op) => FACTORIES[op](options.root));
}
