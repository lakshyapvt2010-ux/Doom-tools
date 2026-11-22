/**
 * @agentic-tools/core — canonical tool contract, result envelope and
 * custom-tool SDK. Zero runtime dependencies.
 *
 * Maps to PRD sections 8.3 (contract), 8.4 (result/error model) and 11
 * (custom tool SDK). Validation, policy, approvals, selection, isolation,
 * tracing and audit live in @agentic-tools/runtime / @agentic-tools/security
 * packages.
 */

export type {
  CapabilityRequest,
  InvocationClass,
  JSONSchema,
  Logger,
  Risk,
  SideEffect,
  ToolContext,
  ToolDefinition
} from "./contract.js";

export {
  ERROR_CODES,
  ToolError,
  failure,
  isToolError,
  isToolResult,
  success,
  toFailure
} from "./result.js";
export type {
  ErrorCode,
  ToolErrorShape,
  ToolFailure,
  ToolResult,
  ToolSuccess,
  TruncationInfo
} from "./result.js";

export { defineTool } from "./define-tool.js";
export type { DefineToolOptions } from "./define-tool.js";

export { defineZodTool } from "./zod.js";
export type { DefineZodToolOptions, ZodLike } from "./zod.js";

export type { SchemaInput } from "./schema-input.js";
