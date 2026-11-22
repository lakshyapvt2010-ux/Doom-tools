/**
 * Config module loading for the CLI (FR-016).
 *
 * A config module is a .mjs/.js file whose default export is a
 * ToolkitOptions object (or a function returning one, possibly async).
 * It is code, not JSON, because tool packages are composed in code.
 */

import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createToolkit, type Toolkit, type ToolkitOptions } from "@agentic-tools/runtime";

export async function loadToolkit(configPath: string): Promise<Toolkit> {
  const abs = resolve(process.cwd(), configPath);
  const mod = (await import(pathToFileURL(abs).href)) as {
    default?: ToolkitOptions | (() => ToolkitOptions | Promise<ToolkitOptions>);
  };
  const exported = mod.default;
  if (exported === undefined || exported === null) {
    throw new Error(`Config module ${configPath} has no default export.`);
  }
  const options = typeof exported === "function" ? await exported() : exported;
  if (!Array.isArray(options.tools)) {
    throw new Error(`Config module ${configPath}: default export needs a tools array.`);
  }
  return createToolkit(options);
}

/** Honest config warnings (PRD 7.1 design notes, FR-016). */
export function configWarnings(toolkit: Toolkit): string[] {
  const warnings: string[] = [];
  const policy = toolkit._state.policy;
  const names = toolkit.listTools().map((t) => t.name);
  const hasShell = names.some((n) => n.startsWith("bash."));
  const networkDeny = policy.network !== "allow-all";
  if (hasShell && networkDeny) {
    warnings.push(
      "Network egress policy cannot be enforced for host-mode shell execution: bash commands can reach the network regardless of the network policy (PRD 7.1, 9.1)."
    );
  }
  if (hasShell) {
    warnings.push(
      "bash runs in trusted-host mode: host privileges, no containment. Every unmatched command is destructive/high and approval-gated by default (PRD 9.3)."
    );
  }
  if (policy.filesystem === "unrestricted") {
    warnings.push(
      "filesystem: \"unrestricted\" disables workspace confinement for filesystem capabilities. Prefer \"workspace-only\" (PRD 9.1)."
    );
  }
  if (toolkit._state.approvers.length === 0 && names.length > 0) {
    warnings.push(
      "No approvers configured: any approval-gated call (destructive/external) will fail with approval_required. Add callback/cli/file-queue approvers (PRD 9.5)."
    );
  }
  return warnings;
}
