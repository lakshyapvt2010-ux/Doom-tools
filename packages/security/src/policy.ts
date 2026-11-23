/**
 * Policy engine (PRD sections 8.5 step 6, 9.1, 9.2, 9.3, 9.4; FR-005).
 *
 * The policy evaluates the CLASSIFIED invocation (FR-020), never just
 * static tool metadata. It fails closed: an unrecognized capability with
 * no explicit grant is denied. All authorization decisions are made here,
 * in runtime code outside the model (PRD 9).
 */

import { isAbsolute, relative, sep } from "node:path";
import type {
  CapabilityRequest,
  InvocationClass,
  Risk,
  SideEffect,
  ToolDefinition
} from "@agentic-tools/core";

/** How a capability or side effect is approval-gated (PRD 9.5). */
export type ApprovalSetting = "always" | "ask" | "never";

export type FilesystemMode = "workspace-only" | "unrestricted";

/**
 * Network egress policy (PRD 9.1). Applies to runtime-mediated tools and
 * sandboxed backends only; it CANNOT be enforced for host-mode shell, and
 * the CLI says so when such a configuration is loaded (PRD 7.1).
 */
export type NetworkMode = "deny-by-default" | "allow-all" | { allowHosts: string[] };

/** Constraint attached to an explicit capability grant (PRD 9.2). */
export interface CapabilityConstraint {
  /** Absolute path prefixes this grant covers (resolved, no trailing sep). */
  paths?: string[];
  /** Host names this grant covers. */
  hosts?: string[];
  /** Explicitly deny instead of grant. */
  deny?: boolean;
}

export interface PolicyConfig {
  /**
   * Single source of truth for the workspace boundary (PRD 7.1). Tools
   * inherit it; a tool-level root may only narrow it.
   */
  workspace: string;
  /** Default "workspace-only" (PRD 9.1). */
  filesystem?: FilesystemMode;
  /** Default "deny-by-default" (PRD 9.1). */
  network?: NetworkMode;
  /**
   * Explicit capability grants/denials, keyed by capability name
   * (e.g. "filesystem.write"). `true` grants unconstrained, `false`
   * denies, an object grants with constraints.
   */
  capabilities?: Record<string, boolean | CapabilityConstraint>;
  /**
   * Approval rules (PRD 9.5). Keys are checked in order: exact tool name,
   * each requested capability, "sideEffect:<kind>". First match wins.
   * Absent a rule, the side-effect default applies: destructive and
   * external actions require approval; read and write do not.
   */
  approvals?: Record<string, ApprovalSetting>;
  /**
   * Whether an approver's "remember" decision may be honored for "ask"
   * rules (PRD 9.5: any "approve always" is scoped narrowly and
   * controlled by policy). Default false.
   */
  allowRememberedApprovals?: boolean;
  /**
   * Bounds for remembered ("approve always") decisions. Remembered
   * decisions expire after ttlMs (default 1 hour) and the store evicts
   * the oldest entries beyond maxEntries (default 256).
   */
  rememberedApprovals?: { ttlMs?: number; maxEntries?: number };
  /** Known secret values to redact from outputs, errors and audit. */
  secrets?: string[];
  /** Audit behavior (PRD 9.1: no sensitive payloads by default). */
  audit?: {
    /** Include redacted input/output payloads in audit events. Default false. */
    payloads?: boolean;
    /** Append events as JSON Lines to this file path. */
    jsonlPath?: string;
  };
  /** Output budgets (PRD 8.4, FR-022). */
  budgets?: {
    /** Max serialized output bytes before truncation. Default 32768. */
    maxOutputBytes?: number;
    /** Serialized payload token budget; default counter is approximate. */
    maxOutputTokens?: number;
    /** Whole compact-JSON runtime envelope, including errors and warnings. Default 65536. */
    maxResultBytes?: number;
    /** Whole-envelope tokens, using the host counter (approximate by default). */
    maxResultTokens?: number;
    /** Per-tool caps may narrow, never widen, toolkit budgets. */
    perTool?: Record<string, { maxOutputBytes?: number; maxOutputTokens?: number; maxResultBytes?: number; maxResultTokens?: number }>;
  };
  /** Default per-invocation timeout in ms. Default 60000. */
  timeouts?: { defaultMs?: number };
}

export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string }
  | { kind: "approval"; rule: string; setting: ApprovalSetting };

export interface ResolvedPolicy {
  workspace: string;
  filesystem: FilesystemMode;
  network: NetworkMode;
  capabilities: Record<string, boolean | CapabilityConstraint>;
  approvals: Record<string, ApprovalSetting>;
  allowRememberedApprovals: boolean;
  rememberTtlMs: number;
  rememberMaxEntries: number;
  secrets: string[];
  auditPayloads: boolean;
  auditJsonlPath?: string;
  maxOutputBytes: number;
  maxOutputTokens?: number;
  maxResultBytes: number;
  maxResultTokens?: number;
  perToolOutputBudgets: Record<string, {maxOutputBytes?: number; maxOutputTokens?: number; maxResultBytes?: number; maxResultTokens?: number}>;
  defaultTimeoutMs: number;
}

export const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024;
export const DEFAULT_TIMEOUT_MS = 60_000;

export function resolvePolicy(config: PolicyConfig): ResolvedPolicy {
  if (!config.workspace || typeof config.workspace !== "string") {
    throw new Error("Policy requires a workspace root (policy.workspace).");
  }
  const resolved: ResolvedPolicy = {
    workspace: config.workspace,
    filesystem: config.filesystem ?? "workspace-only",
    network: config.network ?? "deny-by-default",
    capabilities: config.capabilities ?? {},
    approvals: config.approvals ?? {},
    allowRememberedApprovals: config.allowRememberedApprovals ?? false,
    rememberTtlMs: config.rememberedApprovals?.ttlMs ?? 60 * 60_000,
    rememberMaxEntries: config.rememberedApprovals?.maxEntries ?? 256,
    secrets: config.secrets ?? [],
    auditPayloads: config.audit?.payloads ?? false,
    maxOutputBytes: config.budgets?.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    maxOutputTokens: config.budgets?.maxOutputTokens,
    maxResultBytes: config.budgets?.maxResultBytes ?? 65536,
    maxResultTokens: config.budgets?.maxResultTokens,
    perToolOutputBudgets: config.budgets?.perTool ?? {},
    defaultTimeoutMs: config.timeouts?.defaultMs ?? DEFAULT_TIMEOUT_MS
  };
  for (const budget of [{maxOutputBytes:resolved.maxOutputBytes, maxOutputTokens:resolved.maxOutputTokens, maxResultBytes:resolved.maxResultBytes, maxResultTokens:resolved.maxResultTokens}, ...Object.values(resolved.perToolOutputBudgets)]) {
    for (const value of Object.values(budget)) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) throw new Error("Output budgets must be positive safe integers.");
    }
  }
  if (config.audit?.jsonlPath !== undefined) {
    resolved.auditJsonlPath = config.audit.jsonlPath;
  }
  return resolved;
}

/** True when `candidate` equals or sits inside `root` (both resolved). */
export function isPathWithin(root: string, candidate: string): boolean {
  const suffix = relative(root, candidate);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(".." + sep));
}

function matchHost(pattern: string, host: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return pattern === host;
}

/** Evaluate one capability request against explicit grants and built-in defaults. */
function evaluateCapability(
  policy: ResolvedPolicy,
  request: CapabilityRequest
): { granted: boolean; reason?: string } {
  const explicit = policy.capabilities[request.name];
  if (explicit !== undefined) {
    if (explicit === false) {
      return { granted: false, reason: `capability "${request.name}" denied by policy` };
    }
    if (explicit === true) return { granted: true };
    if (explicit.deny === true) {
      return { granted: false, reason: `capability "${request.name}" denied by policy` };
    }
    // Constrained grant: every declared constraint dimension must hold.
    if (explicit.paths !== undefined) {
      const reqPath = typeof request.path === "string" ? request.path : undefined;
      if (reqPath === undefined) {
        return {
          granted: false,
          reason: `capability "${request.name}" grant requires a path, none supplied`
        };
      }
      const ok = explicit.paths.some((p) => isPathWithin(p, reqPath));
      if (!ok) {
        return {
          granted: false,
          reason: `path "${reqPath}" outside granted roots for "${request.name}"`
        };
      }
    }
    if (explicit.hosts !== undefined) {
      const reqHost = typeof request.host === "string" ? request.host : undefined;
      if (reqHost === undefined || !explicit.hosts.some((h) => matchHost(h, reqHost))) {
        return {
          granted: false,
          reason: `host "${String(reqHost)}" not in grant for "${request.name}"`
        };
      }
    }
    return { granted: true };
  }

  // Built-in defaults (fail closed for anything unknown).
  if (request.name.startsWith("filesystem.")) {
    if (policy.filesystem === "unrestricted") return { granted: true };
    const reqPath = typeof request.path === "string" ? request.path : undefined;
    if (reqPath === undefined) {
      return {
        granted: false,
        reason: `workspace-only policy requires a resolved path for "${request.name}"`
      };
    }
    if (!isPathWithin(policy.workspace, reqPath)) {
      return {
        granted: false,
        reason: `path "${reqPath}" escapes workspace root "${policy.workspace}"`
      };
    }
    return { granted: true };
  }
  if (request.name.startsWith("network.")) {
    if (policy.network === "allow-all") return { granted: true };
    if (typeof policy.network === "object") {
      const reqHost = typeof request.host === "string" ? request.host : undefined;
      if (reqHost !== undefined && policy.network.allowHosts.some((h) => matchHost(h, reqHost))) {
        return { granted: true };
      }
    }
    return {
      granted: false,
      reason: `network egress denied by policy for "${request.name}"`
    };
  }
  if (request.name.startsWith("process.")) {
    // Shell execution is allowed by default only because the tool package
    // itself is an explicit trusted-host opt-in (PRD 9.3); approvals gate
    // it separately. A package that never declares process.execute cannot
    // request it (classification is clamped to declared capabilities).
    return { granted: true };
  }
  if (request.name.startsWith("git.")) {
    const reqPath = typeof request.path === "string" ? request.path : undefined;
    if (reqPath !== undefined && !isPathWithin(policy.workspace, reqPath)) {
      return {
        granted: false,
        reason: `repository path "${reqPath}" escapes workspace root`
      };
    }
    return { granted: true };
  }
  return { granted: false, reason: `no policy grant for capability "${request.name}"` };
}

/**
 * Look up the approval rule for an invocation. Order: exact tool name,
 * then each requested capability, then "sideEffect:<kind>", then the
 * built-in default (destructive/external require approval).
 */
export function approvalRuleFor(
  policy: ResolvedPolicy,
  toolName: string,
  invocation: InvocationClass
): { setting: ApprovalSetting; rule: string } {
  const byTool = policy.approvals[toolName];
  if (byTool !== undefined) return { setting: byTool, rule: `tool "${toolName}"` };
  for (const cap of invocation.capabilities) {
    const byCap = policy.approvals[cap.name];
    if (byCap !== undefined) {
      return { setting: byCap, rule: `capability "${cap.name}"` };
    }
  }
  const sideKey = `sideEffect:${invocation.sideEffect}`;
  const bySide = policy.approvals[sideKey];
  if (bySide !== undefined) return { setting: bySide, rule: sideKey };
  const setting: ApprovalSetting =
    invocation.sideEffect === "destructive" || invocation.sideEffect === "external"
      ? "always"
      : "never";
  return { setting, rule: `default for side effect "${invocation.sideEffect}"` };
}

/**
 * Evaluate policy for a classified invocation (PRD 8.5 step 6).
 * Capability grants are checked first; then approval rules.
 */
export function evaluatePolicy(
  policy: ResolvedPolicy,
  tool: ToolDefinition,
  invocation: InvocationClass
): PolicyDecision {
  for (const cap of invocation.capabilities) {
    const grant = evaluateCapability(policy, cap);
    if (!grant.granted) {
      return { kind: "deny", reason: grant.reason ?? "denied by policy" };
    }
  }
  const approval = approvalRuleFor(policy, tool.name, invocation);
  if (approval.setting === "never") return { kind: "allow" };
  return { kind: "approval", rule: approval.rule, setting: approval.setting };
}

/** Severity order used to clamp classification (PRD 8.3: narrow, never widen). */
export const SIDE_EFFECT_ORDER: readonly SideEffect[] = ["read", "write", "external", "destructive"];
export const RISK_ORDER: readonly Risk[] = ["low", "medium", "high"];
