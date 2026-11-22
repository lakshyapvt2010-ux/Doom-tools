/**
 * @agentic-tools/testing: mock, record and replay tool interactions
 * (PRD FR-014, P1).
 *
 * These helpers wrap ToolDefinitions, so metadata, classification, selection,
 * policy, approvals and audit still run in the runtime. Replay substitutes only
 * the final execute step. A replayed call never reaches the real tool.
 */

import { success, toFailure } from "@agentic-tools/core";
import type { ToolContext, ToolDefinition, ToolResult } from "@agentic-tools/core";

export const RECORDING_VERSION = 1;

export interface RecordedInteraction {
  tool: string;
  version: string;
  /** Canonical JSON of the input (sorted keys). */
  input: string;
  /** Result envelope without timing or trace identity. */
  result: unknown;
}

export interface Recording {
  recordingVersion: typeof RECORDING_VERSION;
  interactions: RecordedInteraction[];
}

/** Deterministic JSON: object keys sorted recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function stripVolatile(result: ToolResult): unknown {
  const { traceId: _t, timing: _ti, ...rest } = result as ToolResult & {
    traceId?: string;
    timing?: unknown;
  };
  return rest;
}

export interface MockHandle<TInput = unknown> {
  tool: ToolDefinition;
  calls: TInput[];
}

/**
 * Replace a tool's implementation with a handler. Metadata and classify are
 * kept so policy and selection behave as they would for the real tool.
 * A handler returns a plain value or throws, like defineTool.
 */
export function mockTool<TInput = unknown, TOutput = unknown>(
  definition: ToolDefinition<TInput, TOutput>,
  handler: (input: TInput, context: ToolContext) => TOutput | Promise<TOutput>
): MockHandle<TInput> {
  const calls: TInput[] = [];
  const tool: ToolDefinition<TInput, TOutput> = {
    ...definition,
    async execute(input, context) {
      calls.push(input);
      try {
        return success(definition, await handler(input, context)) as ToolResult<TOutput>;
      } catch (error) {
        return toFailure(definition, error) as ToolResult<TOutput>;
      }
    }
  };
  return { tool: tool as ToolDefinition, calls };
}

export interface RecordOptions {
  /** Applied to the serialized input and result text before storing. */
  redact?: (text: string) => string;
}

export interface Recorder {
  tools: ToolDefinition[];
  recording(): Recording;
}

/**
 * Wrap tools so each execution is recorded. Pass a redactor: recordings are
 * files and may outlive the secrets they saw. Redaction is best-effort.
 */
export function recordTools(tools: ToolDefinition[], options: RecordOptions = {}): Recorder {
  const interactions: RecordedInteraction[] = [];
  const redact = options.redact ?? ((text: string) => text);
  const wrapped = tools.map((definition): ToolDefinition => ({
    ...definition,
    async execute(input, context) {
      const result = await definition.execute(input, context);
      interactions.push({
        tool: definition.name,
        version: definition.version,
        input: redact(canonicalJson(input)),
        result: JSON.parse(redact(canonicalJson(stripVolatile(result))))
      });
      return result;
    }
  }));
  return {
    tools: wrapped,
    recording: () => ({
      recordingVersion: RECORDING_VERSION,
      interactions: interactions.map((i) => ({ ...i }))
    })
  };
}

export function serializeRecording(recording: Recording): string {
  return JSON.stringify(recording, null, 2) + "\n";
}

/** Parse and validate a recording; throws on any malformed shape. */
export function parseRecording(text: string): Recording {
  const data = JSON.parse(text) as Partial<Recording>;
  if (!data || data.recordingVersion !== RECORDING_VERSION || !Array.isArray(data.interactions)) {
    throw new Error("Unsupported or malformed recording");
  }
  for (const item of data.interactions) {
    if (
      !item ||
      typeof item.tool !== "string" ||
      typeof item.version !== "string" ||
      typeof item.input !== "string" ||
      typeof item.result !== "object" ||
      item.result === null
    ) {
      throw new Error("Malformed recorded interaction");
    }
  }
  return data as Recording;
}

export interface ReplayHandle {
  tools: ToolDefinition[];
  /** Recorded interactions that no call has consumed yet. */
  unconsumed(): RecordedInteraction[];
}

/**
 * Replace execution with recorded results. Matching uses tool name, version and
 * canonical input. Repeated identical calls consume matches in recorded order.
 * An unmatched call fails with not_found; it never falls through to the real tool.
 * Redacted recordings only match inputs that redaction left unchanged.
 */
export function replayTools(tools: ToolDefinition[], recording: Recording): ReplayHandle {
  const queues = new Map<string, RecordedInteraction[]>();
  for (const item of recording.interactions) {
    const key = `${item.tool}\u0000${item.version}\u0000${item.input}`;
    const queue = queues.get(key) ?? [];
    queue.push(item);
    queues.set(key, queue);
  }
  const wrapped = tools.map((definition): ToolDefinition => ({
    ...definition,
    async execute(input) {
      const key = `${definition.name}\u0000${definition.version}\u0000${canonicalJson(input)}`;
      const match = queues.get(key)?.shift();
      if (!match) {
        return {
          status: "error",
          tool: { name: definition.name, version: definition.version },
          error: {
            code: "not_found",
            message: "No recorded interaction matches this tool call"
          }
        } as ToolResult;
      }
      return structuredClone(match.result) as ToolResult;
    }
  }));
  return {
    tools: wrapped,
    unconsumed: () => [...queues.values()].flat()
  };
}
