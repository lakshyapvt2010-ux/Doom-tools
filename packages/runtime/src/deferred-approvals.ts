import type { ApprovalRequest } from "@agentic-tools/security";
import { snapshotInput } from "./input-snapshot.js";
/** Bounded, process-local, single-use tickets. No input payload is retained. */
export class DeferredApprovals {
  private readonly entries = new Map<string, ApprovalRequest>();
  constructor(private readonly maxEntries = 256) {}
  private prune(): void {
    for (const [id, request] of this.entries) if (Date.now() >= request.expiresAt) this.entries.delete(id);
  }
  add(request: ApprovalRequest): void {
    this.prune();
    while (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(request.id, snapshotInput(JSON.parse(JSON.stringify(request))) as ApprovalRequest);
  }
  list(): ApprovalRequest[] { this.prune(); return [...this.entries.values()]; }
  take(id: string): ApprovalRequest | undefined {
    this.prune(); const request = this.entries.get(id); this.entries.delete(id); return request;
  }
  discard(id: string): boolean { return this.entries.delete(id); }
}
