/**
 * Workspace containment (PRD 9.1, FR-007).
 *
 * Every filesystem operation resolves its path against the workspace
 * root and canonicalizes it, following symlinks, so neither traversal
 * (`../../etc`) nor symlink escapes can leave the configured root.
 */

import { realpathSync, existsSync, lstatSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ToolError } from "@agentic-tools/core";

function isWithin(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Canonicalize a path: fully resolve symlinks for the deepest existing
 * ancestor and re-append the non-existent remainder. Catches symlinked
 * files directly and symlinked directories in the middle of a new path.
 */
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

export interface ResolvedPath {
  /** Canonical absolute path (symlinks resolved for existing parts). */
  absolute: string;
  /** Path relative to the workspace root, for display. */
  relative: string;
}

/**
 * Resolve `inputPath` inside `root`, or throw permission_denied (FR-007).
 * Absolute inputs are allowed only when they already sit inside the root.
 */
export function resolveWithin(root: string, inputPath: string): ResolvedPath {
  if (typeof inputPath !== "string" || inputPath.length === 0) {
    throw new ToolError("validation", "Path must be a non-empty string.");
  }
  if (inputPath.includes("\0")) {
    throw new ToolError("validation", "Path must not contain NUL bytes.");
  }
  const resolvedRoot = realpathSync(root);
  const joined = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(resolvedRoot, inputPath);

  // Canonicalize: existing targets resolve fully (catches symlinked
  // files); new targets resolve their nearest existing ancestor (catches
  // symlinked directories in the middle of the path).
  const canonical = canonicalize(joined);

  if (!isWithin(resolvedRoot, canonical)) {
    throw new ToolError(
      "permission_denied",
      `Path "${inputPath}" resolves outside the workspace root.`
    );
  }
  return { absolute: canonical, relative: relative(resolvedRoot, canonical) || "." };
}

/** True when the path is a symlink (used by tools that refuse to follow them). */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
