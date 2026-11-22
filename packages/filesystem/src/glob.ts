/**
 * Minimal glob matching for filesystem.search (no external dependency).
 * Supports ** (any depth), * (within a segment), ? and [class].
 */

import { ToolError } from "@agentic-tools/core";

/**
 * Complexity bounds so a pathological glob (many `*` over long paths)
 * cannot turn the translated RegExp into a resource sink.
 */
const MAX_GLOB_LENGTH = 200;
const MAX_GLOB_WILDCARDS = 16;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|\\]/g, "\\$&");
}

/** Compile a glob pattern to an anchored RegExp over `/`-joined paths. */
export function globToRegExp(glob: string): RegExp {
  if (glob.length > MAX_GLOB_LENGTH) {
    throw new ToolError("validation", `glob exceeds the ${MAX_GLOB_LENGTH}-character limit.`);
  }
  const wildcards = (glob.match(/[?*]/g) ?? []).length;
  if (wildcards > MAX_GLOB_WILDCARDS) {
    throw new ToolError("validation", `glob uses more than ${MAX_GLOB_WILDCARDS} wildcards.`);
  }
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i] as string;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** crosses directories; a trailing "/**" also matches zero dirs.
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
        } else {
          re += ".*";
          i += 2;
        }
      } else {
        re += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      re += "[^/]";
      i += 1;
    } else if (c === "[") {
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        re += "\\[";
        i += 1;
      } else {
        re += glob.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      re += escapeRe(c);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function globMatch(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path.split("\\").join("/"));
}
