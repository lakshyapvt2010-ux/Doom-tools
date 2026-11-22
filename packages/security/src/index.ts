/**
 * @agentic-tools/security — policy engine, capability permissions,
 * approvals, redaction and audit (PRD section 9).
 */

export {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  RISK_ORDER,
  SIDE_EFFECT_ORDER,
  approvalRuleFor,
  evaluatePolicy,
  isPathWithin,
  resolvePolicy
} from "./policy.js";
export type {
  ApprovalSetting,
  CapabilityConstraint,
  FilesystemMode,
  NetworkMode,
  PolicyConfig,
  PolicyDecision,
  ResolvedPolicy
} from "./policy.js";

export { REDACTED, createRedactor } from "./redact.js";
export type { Redactor, RedactorOptions } from "./redact.js";

export { jsonlAuditSink, memoryAuditSink, newAuditEvent } from "./audit.js";
export type { AuditEvent, AuditEventType, AuditSink } from "./audit.js";

export { ApprovalManager, approvalInputHash } from "./approvals.js";
export type { ApprovalDecision, ApprovalRequest, Approver } from "./approvals.js";

export {
  allowAllApprover,
  callbackApprover,
  cliApprover,
  denyAllApprover,
  fileQueueApprover,
  listQueuedApprovals,
  writeQueuedDecision
} from "./approvers.js";
