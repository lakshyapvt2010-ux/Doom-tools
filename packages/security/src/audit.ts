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

export function memoryAuditSink(into?: AuditEvent[]): AuditSink & { events: AuditEvent[] } {
  const events = into ?? [];
  return {
    events,
    record(event) {
      events.push(event);
    }
  };
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
