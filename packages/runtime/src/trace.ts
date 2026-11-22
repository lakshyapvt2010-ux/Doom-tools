/**
 * Trace collection (PRD 8.2, FR-015).
 *
 * Traces include tool, duration, status and policy metadata. Payload
 * capture is configurable and redacted; it is off by default.
 */

export interface TraceRecord {
  traceId: string;
  tool: { name: string; version: string };
  startedAt: number;
  durationMs: number;
  status: "success" | "error";
  errorCode?: string;
  policyDecision: "allow" | "deny" | "approval";
  approvalOutcome?: "allow" | "deny" | "unavailable";
  metadata?: Record<string, unknown>;
}

export class TraceCollector {
  private readonly records: TraceRecord[] = [];
  constructor(private readonly capacity = 1000) {}

  record(record: TraceRecord): void {
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
  }

  list(): TraceRecord[] {
    return [...this.records];
  }
}
