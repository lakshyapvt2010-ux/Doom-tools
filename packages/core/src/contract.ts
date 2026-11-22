import type { ToolResult } from "./result.js";

/**
 * Canonical tool contract (PRD section 8.3).
 *
 * Every tool, built-in or custom, is described by one ToolDefinition.
 * Static metadata is an upper bound on what a call can do; the optional
 * classify hook refines side effect, risk and capabilities for one concrete
 * input. A classification may narrow but never exceed the declared bounds,
 * and the runtime falls back to the static bounds when classification fails
 * (fail closed). Enforcement lives in the runtime, not in this package.
 */

/** PRD 8.3: side-effect classification. Declared, never inferred by the model. */
export type SideEffect = "read" | "write" | "external" | "destructive";

/** PRD 8.3: static risk level. */
export type Risk = "low" | "medium" | "high";

/**
 * JSON Schema, the canonical interchange format (PRD 8.3, proposed).
 * Zod may be used as an authoring convenience (see defineZodTool) but is
 * converted to JSON Schema at registration; it is never the wire format.
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema | JSONSchema[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  anyOf?: JSONSchema[];
  oneOf?: JSONSchema[];
  allOf?: JSONSchema[];
  not?: JSONSchema;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  [keyword: string]: unknown;
}

/**
 * One capability bound to a concrete resource for a single invocation,
 * e.g. { name: "filesystem.write", path: "<resolved path>" } (PRD 8.3).
 */
export interface CapabilityRequest {
  name: string;
  [constraint: string]: unknown;
}

/** Result of per-invocation classification (PRD 8.3, FR-020). */
export interface InvocationClass {
  sideEffect: SideEffect;
  risk: Risk;
  capabilities: CapabilityRequest[];
}

/** Minimal structured logger the runtime provides to tools. */
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Scoped execution context handed to a tool by the runtime (PRD 8.3).
 *
 * `services` contains only services the host application registered via
 * createToolkit({ services }) AND that the tool declared and policy granted.
 * Anything else must fail with permission_denied in the runtime. Tools must
 * not receive unrestricted global access by default.
 */
export interface ToolContext {
  /** Correlation ID shared by trace, metrics and audit events (PRD 8.4). */
  traceId: string;
  /** Cancellation signal; tools must abort promptly when fired (FR-008). */
  signal: AbortSignal;
  /** Absolute deadline (epoch ms) when the runtime set one. */
  deadline?: number;
  logger: Logger;
  /** Policy-approved, host-registered service handles. */
  services: Record<string, unknown>;
  /**
   * The workspace root from policy: the single source of truth for the
   * filesystem boundary (PRD 7.1). Tools inherit it; a tool-level root
   * may only narrow it, never widen it.
   */
  workspace: string;
}

/**
 * The canonical tool definition. `execute` returns the structured result
 * envelope; authors normally build tools with defineTool, which produces
 * this shape from plain returns and thrown errors (PRD 8.3).
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  version: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  /** Static upper bound. classify() may narrow, never widen. */
  sideEffect: SideEffect;
  /** Static set of capabilities the tool may request. */
  capabilities: string[];
  /** Static default risk. */
  risk: Risk;
  /**
   * Optional grouping labels for run-level selection (PRD 8.6:
   * toolkit.select may narrow by name, tag, side effect, risk or
   * capability). Tags carry no policy meaning on their own.
   */
  tags?: string[];
  /**
   * Optional per-invocation refinement. Required for tools whose risk
   * depends on their arguments (shell, SQL, HTTP, browser, cloud).
   * Runs before policy evaluation (FR-020).
   */
  classify?(input: TInput): InvocationClass;
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}
