/**
 * Capability path canonicalization (runtime side of FR-007).
 *
 * Tools' classify hooks supply relative paths (they do not see the
 * workspace root). Between classification (step 4) and policy evaluation
 * (step 6) the runtime resolves every capability `path` against the
 * policy workspace and canonicalizes it through the nearest existing
 * ancestor, so policy denies traversal and symlink escapes before any
 * side effect.
 */

import { existsSync, realpathSync, lstatSync, readlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

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

/** Resolve a capability request path against the workspace, canonicalized. */
export function canonicalizeCapabilityPath(workspace: string, requestPath: string): string {
  const joined = isAbsolute(requestPath) ? resolve(requestPath) : resolve(workspace, requestPath);
  try {
    return canonicalize(joined);
  } catch {
    return joined; // unresolvable paths stay as-is; policy still checks them
  }
}
