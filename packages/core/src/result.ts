/**
 * Standard result and error model (PRD section 8.4).
 *
 * Every execution returns a structured success or failure envelope carrying
 * tool identity, status, output or a stable error, warnings, timing and
 * sanitized metadata. Raw secrets, stack traces and environment values must
 * not be exposed through this envelope; sanitization is enforced by the
 * runtime, but authors should already keep error messages safe here.
 */

/** Stable error codes (PRD 8.4). */
export const ERROR_CODES = [
  "validation",
  "permission_denied",
  "approval_required",
  "timeout",
  "cancelled",
  "resource_limit",
  "not_found",
  "conflict",
  "provider_error",
  "execution_error"
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** Model-facing error shape: stable code plus a safe message. */
export interface ToolErrorShape {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  /** Optional sanitized structured detail. No secrets or stack traces. */
  details?: Record<string, unknown>;
}

/**
 * Explicit truncation marker (PRD 8.4, FR-022). Truncation must never
 * silently drop content; when output is cut, say what was cut and how to
 * retrieve more (e.g. a pagination cursor).
 */
export interface TruncationInfo {
  truncated: true;
  /** What was cut, e.g. "bytes", "tokens", "entries". */
  unit: string;
  omitted: number;
  /** Cursor or instruction to retrieve the remainder, when available. */
  continuation?: string;
}

interface EnvelopeBase {
  tool: { name: string; version: string };
  traceId?: string;
  warnings?: string[];
  timing?: { startedAt: number; durationMs: number };
  metadata?: Record<string, unknown>;
  truncation?: TruncationInfo;
}

export interface ToolSuccess<TOutput = unknown> extends EnvelopeBase {
  status: "success";
  output: TOutput;
}

export interface ToolFailure extends EnvelopeBase {
  status: "error";
  error: ToolErrorShape;
}

export type ToolResult<TOutput = unknown> = ToolSuccess<TOutput> | ToolFailure;

/**
 * Throw from a tool's execute to fail with a stable code. defineTool maps
 * it onto the failure envelope. Keep the message safe for model exposure.
 */
export class ToolError extends Error {
  readonly code: ErrorCode;
  readonly retryable?: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown }
  ) {
    super(message, { cause: options?.cause });
    this.name = "ToolError";
    this.code = code;
    this.retryable = options?.retryable;
    this.details = options?.details;
  }
}

export function isToolError(err: unknown): err is ToolError {
  return err instanceof ToolError;
}

export function success<TOutput>(
  tool: { name: string; version: string },
  output: TOutput,
  extra?: Partial<EnvelopeBase>
): ToolSuccess<TOutput> {
  return { status: "success", tool, output, ...extra };
}

export function failure(
  tool: { name: string; version: string },
  error: ToolErrorShape,
  extra?: Partial<EnvelopeBase>
): ToolFailure {
  return { status: "error", tool, error, ...extra };
}

/**
 * Map an arbitrary thrown value onto the stable error model (PRD 8.3:
 * defineTool maps thrown errors so authors need no explicit envelope).
 * ToolError keeps its code and message as the intentional disclosure path.
 * Arbitrary exceptions get a stable generic message; their text, cause and
 * stack may contain unknown secrets and are not model-facing diagnostics.
 */
export function toFailure(
  tool: { name: string; version: string },
  err: unknown,
  extra?: Partial<EnvelopeBase>
): ToolFailure {
  if (isToolError(err)) {
    const shape: ToolErrorShape = { code: err.code, message: err.message };
    if (err.retryable !== undefined) shape.retryable = err.retryable;
    if (err.details !== undefined) shape.details = err.details;
    return failure(tool, shape, extra);
  }
  const message = "Tool execution failed. Use an intentional ToolError for safe diagnostics.";
  return failure(tool, { code: "execution_error", message }, extra);
}

/**
 * Type guard for an author-constructed envelope. defineTool passes these
 * through untouched so authors can attach warnings, timing, metadata or a
 * truncation marker (PRD 8.3).
 *
 * Detection requires the full envelope shape: a `tool` object with string
 * `name` and `version`, plus either status "success" with an `output`
 * field, or status "error" with an `error` carrying a stable ErrorCode and
 * a string message. Ordinary business outputs that merely have a `status`
 * field (e.g. { status: "active" } or { status: "success", output: ... }
 * without tool identity) are NOT envelopes and stay plain outputs. The one
 * remaining ambiguity is inherent: a plain output that reproduces the
 * entire envelope shape, tool identity included, is indistinguishable from
 * an envelope and will be treated as one.
 */
export function isToolResult<TOutput = unknown>(
  value: unknown
): value is ToolResult<TOutput> {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const tool = v.tool;
  if (typeof tool !== "object" || tool === null) return false;
  const { name, version } = tool as Record<string, unknown>;
  if (typeof name !== "string" || typeof version !== "string") return false;
  if (v.status === "success") return "output" in v;
  if (v.status === "error") {
    const err = v.error;
    if (typeof err !== "object" || err === null) return false;
    const { code, message } = err as Record<string, unknown>;
    return (
      typeof code === "string" &&
      (ERROR_CODES as readonly string[]).includes(code) &&
      typeof message === "string"
    );
  }
  return false;
}
