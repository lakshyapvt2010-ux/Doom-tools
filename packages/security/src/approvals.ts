/**
 * Runtime-owned approval flow (PRD 9.5, FR-006).
 *
 * An approval request is a first-class runtime object: ID, tool,
 * classified invocation, triggering policy rule, redacted input preview
 * and an expiry. A decision is bound to the exact classified input via
 * inputHash, so approving one command never approves another. With no
 * approver available the call fails with approval_required; it is never
 * auto-approved.
 */

import { createHash, randomUUID } from "node:crypto";
import type { InvocationClass } from "@agentic-tools/core";
import type { ApprovalSetting } from "./policy.js";
import type { Redactor } from "./redact.js";

export interface ApprovalRequest {
  id: string;
  traceId: string;
  tool: { name: string; version: string };
  invocation: InvocationClass;
  /** The policy rule that triggered the request. */
  rule: string;
  /** Redacted, length-capped preview of the input. */
  inputPreview: string;
  /** sha256 over the canonical { tool, input, invocation } triple. */
  inputHash: string;
  createdAt: number;
  expiresAt: number;
}

export interface ApprovalDecision {
  outcome: "allow" | "deny";
  /**
   * "once" (default) applies to this invocation only. "remember" is
   * honored only for "ask" rules when policy allowRememberedApprovals is
   * true (PRD 9.5: approve-always is scoped narrowly and policy-controlled).
   */
  scope?: "once" | "remember";
  reason?: string;
  decidedBy?: string;
}

export interface Approver {
  name: string;
  /**
   * True when presenting a request would claim the process stdio streams
   * (the CLI prompt approver). Transports that own stdio - the MCP stdio
   * server - must not treat such an approver as an available out-of-band
   * path, and it must never be counted when deciding tool exposure.
   */
  usesStdio?: boolean;
  /**
   * Decide a request. Return null when this approver cannot present it
   * (e.g. non-interactive context); the manager tries the next approver.
   */
  approve(request: ApprovalRequest, context: { signal?: AbortSignal }): Promise<ApprovalDecision | null>;
}

const INPUT_PREVIEW_BYTES = 600;
const DEFAULT_EXPIRY_MS = 5 * 60_000;
/** Remembered decisions expire (default 1h) and the store is bounded. */
const DEFAULT_REMEMBER_TTL_MS = 60 * 60_000;
const DEFAULT_REMEMBER_MAX_ENTRIES = 256;

interface RememberedEntry {
  decision: ApprovalDecision;
  expiresAt: number;
}

/** Canonical JSON with sorted keys, for stable hashing. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && typeof v !== "function")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(",")}}`;
}

export function approvalInputHash(
  tool: { name: string; version: string },
  input: unknown,
  invocation: InvocationClass
): string {
  const canonical = canonicalJson({ tool, input, invocation });
  return createHash("sha256").update(canonical).digest("hex");
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision | null) => void;
}

export class ApprovalManager {
  private readonly redactor: Redactor;
  private readonly expiryMs: number;
  private readonly allowRemembered: boolean;
  private readonly rememberTtlMs: number;
  private readonly rememberMaxEntries: number;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly remembered = new Map<string, RememberedEntry>();

  constructor(options: {
    redactor: Redactor;
    expiryMs?: number;
    allowRememberedApprovals?: boolean;
    rememberTtlMs?: number;
    rememberMaxEntries?: number;
  }) {
    this.redactor = options.redactor;
    this.expiryMs = options.expiryMs ?? DEFAULT_EXPIRY_MS;
    this.allowRemembered = options.allowRememberedApprovals ?? false;
    this.rememberTtlMs = options.rememberTtlMs ?? DEFAULT_REMEMBER_TTL_MS;
    this.rememberMaxEntries = options.rememberMaxEntries ?? DEFAULT_REMEMBER_MAX_ENTRIES;
  }

  createRequest(
    tool: { name: string; version: string },
    input: unknown,
    invocation: InvocationClass,
    rule: string,
    traceId: string
  ): ApprovalRequest {
    const now = Date.now();
    let preview = this.redactor.redactText(safeStringify(input));
    if (preview.length > INPUT_PREVIEW_BYTES) {
      preview = preview.slice(0, INPUT_PREVIEW_BYTES) + "...";
    }
    return {
      id: randomUUID(),
      traceId,
      tool,
      invocation,
      rule,
      inputPreview: preview,
      inputHash: approvalInputHash(tool, input, invocation),
      createdAt: now,
      expiresAt: now + this.expiryMs
    };
  }

  /** A remembered decision applies only to "ask" rules, when policy allows. */
  rememberedDecision(
    request: { inputHash: string },
    setting: ApprovalSetting
  ): ApprovalDecision | null {
    if (setting !== "ask" || !this.allowRemembered) return null;
    const entry = this.remembered.get(request.inputHash);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.remembered.delete(request.inputHash);
      return null;
    }
    return entry.decision;
  }

  /** Invalidate every remembered decision (e.g. on policy reload). */
  clearRemembered(): void {
    this.remembered.clear();
  }

  private remember(inputHash: string, decision: ApprovalDecision): void {
    const now = Date.now();
    for (const [key, entry] of this.remembered) {
      if (now > entry.expiresAt) this.remembered.delete(key);
    }
    while (this.remembered.size >= this.rememberMaxEntries) {
      const oldest = this.remembered.keys().next().value;
      if (oldest === undefined) break;
      this.remembered.delete(oldest);
    }
    this.remembered.set(inputHash, { decision, expiresAt: now + this.rememberTtlMs });
  }

  listPending(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.request);
  }

  /**
   * Route the request through the given approvers in order. Resolves with
   * the decision, or null when no approver could present the request or
   * it expired. Never auto-approves.
   */
  async requestApproval(
    request: ApprovalRequest,
    approvers: Approver[],
    context: { signal?: AbortSignal } = {}
  ): Promise<ApprovalDecision | null> {
    for (const approver of approvers) {
      if (context.signal?.aborted || Date.now() >= request.expiresAt) return null;
      let decision: ApprovalDecision | null = null;
      try {
        decision = await this.presentTo(approver, request, context);
      } catch {
        decision = null; // an approver error never approves
      }
      if (context.signal?.aborted || Date.now() >= request.expiresAt) return null;
      if (!decision || typeof decision !== "object" ||
          (decision.outcome !== "allow" && decision.outcome !== "deny")) continue;
      if (decision.outcome === "deny") return decision;
      if (
        decision.scope === "remember" &&
        this.allowRemembered &&
        Date.now() <= request.expiresAt
      ) {
        this.remember(request.inputHash, { ...decision, scope: "remember" });
      }
      return { ...decision, scope: decision.scope ?? "once" };
    }
    return null;
  }

  private presentTo(
    approver: Approver,
    request: ApprovalRequest,
    context: { signal?: AbortSignal }
  ): Promise<ApprovalDecision | null> {
    return new Promise((resolvePromise) => {
      if (context.signal?.aborted || Date.now() >= request.expiresAt) {
        resolvePromise(null);
        return;
      }
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (decision: ApprovalDecision | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        context.signal?.removeEventListener("abort", onAbort);
        this.pending.delete(request.id);
        resolvePromise(context.signal?.aborted || Date.now() >= request.expiresAt ? null : decision);
      };
      const onAbort = () => settle(null);
      this.pending.set(request.id, { request, resolve: settle });
      timer = setTimeout(() => settle(null), Math.max(0, request.expiresAt - Date.now()));
      context.signal?.addEventListener("abort", onAbort, { once: true });
      Promise.resolve().then(() => {
        if (context.signal?.aborted) return null;
        return approver.approve(request, context);
      }).then(settle, () => settle(null));
    });
  }

  /**
   * Out-of-band decision for a pending request (e.g. resolved through the
   * CLI queue approver). Returns false when the request is unknown.
   */
  resolveOutOfBand(requestId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(requestId);
    if (!entry) return false;
    this.pending.delete(requestId);
    entry.resolve(decision);
    return true;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable input]";
  }
}
