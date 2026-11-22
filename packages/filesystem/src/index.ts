/**
 * @agentic-tools/filesystem — workspace-scoped filesystem tools.
 *
 * Default operation set (read, list, search, grep, diff) is read-only;
 * write and edit must be listed explicitly (PRD 8.6). All paths are
 * confined to the policy workspace root (FR-007).
 */

export {
  FILESYSTEM_DEFAULT_OPERATIONS,
  FILESYSTEM_OPERATIONS,
  filesystem
} from "./tools.js";
export type { FilesystemOperation, FilesystemOptions } from "./tools.js";
export { resolveWithin } from "./paths.js";
export { globMatch, globToRegExp } from "./glob.js";
export { diffLines, hasChanges, renderUnified } from "./ldiff.js";
