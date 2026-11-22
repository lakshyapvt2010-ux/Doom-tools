/**
 * Canonical tool registry (PRD 8.1/8.2, FR-003).
 *
 * Tools register under name and version, are discovered and resolved
 * without framework-specific code. Selection (which of these a model may
 * call) is enforced by the toolkit, not the registry (FR-019).
 */

import { Ajv } from "ajv";
import type { ToolDefinition } from "@agentic-tools/core";

// SemVer precedence ignores build metadata and compares numeric identifiers numerically.
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  // Imported MCP tools use opaque versions; retain those exact identities.
  if (!pa || !pb) return pa ? 1 : pb ? -1 : a < b ? -1 : a > b ? 1 : 0;
  for (let i = 1; i <= 3; i++) {
    if (BigInt(pa[i]!) !== BigInt(pb[i]!)) return BigInt(pa[i]!) < BigInt(pb[i]!) ? -1 : 1;
  }
  if (pa[4] === undefined || pb[4] === undefined) return pa[4] === pb[4] ? 0 : pa[4] === undefined ? 1 : -1;
  const aa = pa[4].split(".");
  const bb = pb[4].split(".");
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const x = aa[i], y = bb[i];
    if (x === y) continue;
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    const nx = /^[0-9]+$/.test(x), ny = /^[0-9]+$/.test(y);
    if (nx && ny) return BigInt(x) < BigInt(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function validateDefinition(tool: ToolDefinition): void {
  if (!tool || typeof tool !== "object" || typeof tool.name !== "string" ||
      !/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(tool.name) ||
      typeof tool.version !== "string" || !tool.version.trim() ||
      typeof tool.description !== "string" || !tool.description.trim() ||
      !["read", "write", "external", "destructive"].includes(tool.sideEffect) ||
      !["low", "medium", "high"].includes(tool.risk) ||
      !Array.isArray(tool.capabilities) || tool.capabilities.some(c => typeof c !== "string" || !c.trim()) ||
      typeof tool.execute !== "function" ||
      (tool.classify !== undefined && typeof tool.classify !== "function") ||
      (tool.tags !== undefined && (!Array.isArray(tool.tags) || tool.tags.some(t => typeof t !== "string")))) {
    throw new Error("Invalid tool metadata: name, version, description, classification and execution are required.");
  }
  const ajv = new Ajv({ strict: false, addUsedSchema: false });
  for (const schema of [tool.inputSchema, ...(tool.outputSchema === undefined ? [] : [tool.outputSchema])]) {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("Tool schemas must be JSON Schema objects.");
    try { ajv.compile(schema); }
    catch { throw new Error("Tool schema is invalid or uses an unsupported schema dialect or reference."); }
  }
}

export class ToolRegistry {
  private readonly byName = new Map<string, Map<string, ToolDefinition>>();

  register(tool: ToolDefinition): void {
    validateDefinition(tool);
    let versions = this.byName.get(tool.name);
    if (!versions) {
      versions = new Map();
      this.byName.set(tool.name, versions);
    }
    if (versions.has(tool.version)) {
      throw new Error(`Tool "${tool.name}" version ${tool.version} is already registered.`);
    }
    versions.set(tool.version, tool);
  }

  /** Resolve the latest registered version, or a specific one. */
  resolve(name: string, version?: string): ToolDefinition | null {
    const versions = this.byName.get(name);
    if (!versions) return null;
    if (version !== undefined) return versions.get(version) ?? null;
    const latest = [...versions.keys()].sort(compareVersions).pop();
    return latest === undefined ? null : versions.get(latest) ?? null;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  list(): ToolDefinition[] {
    const out: ToolDefinition[] = [];
    for (const versions of this.byName.values()) {
      const latest = [...versions.keys()].sort(compareVersions).pop();
      if (latest !== undefined) {
        const def = versions.get(latest);
        if (def) out.push(def);
      }
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : 1));
  }
}
