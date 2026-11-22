/**
 * Audit events and sinks (PRD 9.1 auditability, FR-010, FR-015).
 *
 * Every invocation produces correlatable events: invocation start, policy
 * decision, approval request/decision and invocation end. Sensitive
 * payloads are excluded by default (PRD 9.1); when payload capture is
 * enabled it passes through the redactor.
 */

import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Redactor } from "./redact.js";

export type AuditEventType =
  | "invocation.start"
  | "policy.decision"
  | "approval.request"
  | "approval.decision"
  | "invocation.end";

export interface AuditEvent {
  id: string;
  ts: number;
  type: AuditEventType;
  traceId: string;
  tool?: { name: string; version: string };
  /** Policy decision summary, never the raw input. */
  decision?: string;
  /** Outcome summary for invocation.end. */
  outcome?: { status: "success" | "error"; errorCode?: string; durationMs: number };
  /** Redacted payloads, only when policy audit.payloads is true. */
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface AuditSink {
  record(event: AuditEvent): void;
}

export const DEFAULT_AUDIT_MEMORY_LIMIT = 10_000;

/**
 * Bounded in-memory sink. When the limit is reached the oldest events are
 * dropped and `dropped` counts them, so a long-lived toolkit cannot grow
 * without bound. Hosts needing a full record add a durable sink (FR-015).
 */
export function memoryAuditSink(
  into?: AuditEvent[],
  limit = DEFAULT_AUDIT_MEMORY_LIMIT
): AuditSink & { events: AuditEvent[]; dropped: number } {
  const events = into ?? [];
  const sink = {
    events,
    dropped: 0,
    record(event: AuditEvent) {
      events.push(event);
      if (events.length > limit) {
        const excess = events.length - limit;
        events.splice(0, excess);
        sink.dropped += excess;
      }
    }
  };
  return sink;
}

/** Append-only JSON Lines sink. Payloads are redacted before writing. */
export function jsonlAuditSink(path: string, redactor: Redactor): AuditSink {
  return {
    record(event) {
      const line = JSON.stringify(redactor.redactValue(event)) + "\n";
      appendFileSync(path, line, "utf8");
    }
  };
}

export function newAuditEvent(
  type: AuditEventType,
  traceId: string,
  fields: Partial<AuditEvent> = {}
): AuditEvent {
  return { id: randomUUID(), ts: Date.now(), type, traceId, ...fields };
}
