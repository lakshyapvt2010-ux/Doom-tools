/**
 * Canonical tool registry (PRD 8.1/8.2, FR-003).
 *
 * Tools register under name and version, are discovered and resolved
 * without framework-specific code. Selection (which of these a model may
 * call) is enforced by the toolkit, not the registry (FR-019).
 */

import type { ToolDefinition } from "@agentic-tools/core";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export class ToolRegistry {
  private readonly byName = new Map<string, Map<string, ToolDefinition>>();

  register(tool: ToolDefinition): void {
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
