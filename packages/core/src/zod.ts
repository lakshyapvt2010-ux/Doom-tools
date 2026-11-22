/**
 * Optional Zod authoring convenience (PRD 8.3, open decision 21.4).
 *
 * JSON Schema is the canonical format. A Zod schema may be used to author
 * a tool, but it is converted to JSON Schema at registration; Zod is never
 * the wire format.
 *
 * @agentic-tools/core stays dependency-free, so the caller supplies the
 * converter (e.g. zod-to-json-schema). A first-party adapter package that
 * bundles Zod plus its converter is roadmap; confirm the ergonomics in the
 * prototype before committing (PRD decision 21.4).
 */

import type { JSONSchema, ToolContext, ToolDefinition } from "./contract.js";
import { defineTool, type DefineToolOptions } from "./define-tool.js";
import { ToolError } from "./result.js";

/** Structural stand-in for z.ZodType so core need not depend on zod. */
export interface ZodLike<TOutput> {
  parse(input: unknown): TOutput;
}

export interface DefineZodToolOptions<TInput, TOutput>
  extends Omit<DefineToolOptions<TInput, TOutput>, "inputSchema" | "execute"> {
  schema: ZodLike<TInput>;
  /** Convert the Zod schema to JSON Schema, e.g. zod-to-json-schema. */
  toJSONSchema(schema: ZodLike<TInput>): JSONSchema;
  execute(input: TInput, context: ToolContext): Promise<TOutput> | TOutput;
}

export function defineZodTool<TInput, TOutput>(
  options: DefineZodToolOptions<TInput, TOutput>
): ToolDefinition<TInput, TOutput> {
  const inputSchema = options.toJSONSchema(options.schema);
  return defineTool<TInput, TOutput>({
    ...options,
    inputSchema,
    async execute(rawInput: unknown, context: ToolContext): Promise<TOutput> {
      let input: TInput;
      try {
        input = options.schema.parse(rawInput);
      } catch (err) {
        // Authoring-level parse: the runtime validates the JSON Schema
        // before execution (FR-002); this is a second line of defense for
        // direct invocations and maps onto the same stable code.
        throw new ToolError("validation", "Input failed schema validation.", {
          cause: err
        });
      }
      return options.execute(input, context);
    }
  });
}
