import { ERROR_CODES } from "@agentic-tools/core";
import type { TraceRecord } from "./trace.js";

export interface MetricRecord {
  tool: string;
  policyDecision: TraceRecord["policyDecision"];
  status: "success" | "error";
  errorCode?: string;
  count: number;
  totalDurationMs: number;
  maxDurationMs: number;
}

/** In-memory counters only. No inputs, outputs, trace IDs or network traffic. */
export class MetricsCollector {
  private readonly counters = new Map<string, MetricRecord>();
  constructor(private readonly capacity = 1024) {}

  record(event: Omit<MetricRecord, "count" | "totalDurationMs" | "maxDurationMs"> & { durationMs: number }): void {
    const errorCode = event.errorCode && (ERROR_CODES as readonly string[]).includes(event.errorCode)
      ? event.errorCode : event.status === "error" ? "execution_error" : undefined;
    const key = JSON.stringify([event.tool, event.policyDecision, event.status, errorCode]);
    let counter = this.counters.get(key);
    if (!counter) {
      // Hard retention cap, including when a host registers many tool names.
      if (this.counters.size >= this.capacity) {
        const first = this.counters.keys().next().value;
        if (first !== undefined) this.counters.delete(first);
      }
      counter = { tool: event.tool, policyDecision: event.policyDecision, status: event.status,
        ...(errorCode ? { errorCode } : {}), count: 0, totalDurationMs: 0, maxDurationMs: 0 };
      this.counters.set(key, counter);
    }
    counter.count++;
    counter.totalDurationMs += event.durationMs;
    counter.maxDurationMs = Math.max(counter.maxDurationMs, event.durationMs);
  }

  snapshot(): MetricRecord[] {
    return [...this.counters.values()].map((counter) => ({ ...counter }));
  }
  clear(): void { this.counters.clear(); }
}
