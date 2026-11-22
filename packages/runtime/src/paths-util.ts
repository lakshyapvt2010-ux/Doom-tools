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

import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

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

/** Resolve a capability request path against the workspace, canonicalized. */
export function canonicalizeCapabilityPath(workspace: string, requestPath: string): string {
  const joined = isAbsolute(requestPath) ? resolve(requestPath) : resolve(workspace, requestPath);
  try {
    return canonicalize(joined);
  } catch {
    return joined; // unresolvable paths stay as-is; policy still checks them
  }
}
