/**
 * defineTool — the typed custom-tool authoring helper (PRD section 11).
 *
 * Authors return a plain value or throw; the SDK wraps the value in a
 * success envelope and maps thrown errors onto the stable error model
 * (PRD 8.3/8.4). To attach warnings, timing, metadata or a truncation
 * marker, return a ToolResult built with success()/failure(); envelopes
 * are passed through untouched (only a missing traceId is filled in).
 *
 * What this helper deliberately does NOT do (runtime responsibilities,
 * PRD 8.5): input validation against the schema (FR-002), policy and
 * capability checks (FR-005), approvals (FR-006), selection enforcement
 * (FR-019), timeouts and output shaping (FR-008/FR-022), tracing and audit
 * (FR-010/FR-015). defineTool only produces a valid ToolDefinition.
 */

import type {
  InvocationClass,
  JSONSchema,
  Risk,
  SideEffect,
  ToolContext,
  ToolDefinition
} from "./contract.js";
import {
  isToolResult,
  success,
  toFailure,
  type ToolResult
} from "./result.js";

export interface DefineToolOptions<TInput, TOutput> {
  name: string;
  description: string;
  /** Defaults to "0.0.0". Bump on behavior or schema changes. */
  version?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
  sideEffect: SideEffect;
  /** Static upper bound of capabilities this tool may request. */
  capabilities?: string[];
  /** Static default risk; defaults to "low". */
  risk?: Risk;
  /** Optional grouping labels for run-level selection (PRD 8.6). */
  tags?: string[];
  /**
   * Per-invocation refinement (FR-020). Required for argument-dependent
   * risk (shell, SQL, HTTP, browser, cloud). May narrow, never widen, the
   * static bounds; the runtime enforces that and fails closed on throws.
   */
  classify?(input: TInput): InvocationClass;
  execute(
    input: TInput,
    context: ToolContext
  ): Promise<TOutput | ToolResult<TOutput>> | TOutput | ToolResult<TOutput>;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

/** Fail fast at registration time on invalid metadata (PRD 8.5 step 1). */
function assertValidMetadata(options: DefineToolOptions<unknown, unknown>): void {
  if (!NAME_PATTERN.test(options.name)) {
    throw new Error(
      `Invalid tool name "${options.name}". Use lowercase dot- or underscore-separated names, e.g. "filesystem.read".`
    );
  }
  if (!options.description || !options.description.trim()) {
    throw new Error(`Tool "${options.name}" needs a non-empty description.`);
  }
  if (!options.inputSchema || typeof options.inputSchema !== "object") {
    throw new Error(`Tool "${options.name}" needs a JSON Schema inputSchema.`);
  }
  if (typeof options.execute !== "function") {
    throw new Error(`Tool "${options.name}" needs an execute function.`);
  }
}

export function defineTool<TInput = unknown, TOutput = unknown>(
  options: DefineToolOptions<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  assertValidMetadata(options as DefineToolOptions<unknown, unknown>);

  const name = options.name;
  const version = options.version ?? "0.0.0";
  const toolRef = { name, version };

  const definition: ToolDefinition<TInput, TOutput> = {
    name,
    version,
    description: options.description,
    inputSchema: options.inputSchema,
    sideEffect: options.sideEffect,
    capabilities: options.capabilities ?? [],
    risk: options.risk ?? "low",
    ...(options.tags !== undefined ? { tags: options.tags } : {}),
    async execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>> {
      try {
        const result = await options.execute(input, context);
        if (isToolResult<TOutput>(result)) {
          return result.traceId === undefined
            ? { ...result, traceId: context.traceId }
            : result;
        }
        return success(toolRef, result, { traceId: context.traceId });
      } catch (err) {
        return toFailure(toolRef, err, { traceId: context.traceId });
      }
    }
  };

  if (options.outputSchema !== undefined) definition.outputSchema = options.outputSchema;
  if (options.classify !== undefined) {
    const classify = options.classify;
    definition.classify = (input: TInput) => classify(input);
  }

  return definition;
}
