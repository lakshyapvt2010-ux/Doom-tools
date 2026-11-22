import assert from "node:assert/strict";
import test from "node:test";
import { defineTool, type SchemaInput } from "../src/index.js";

const inferred = defineTool({
  name: "types.inferred",
  description: "Infer a JSON input without manual generics",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      count: { type: "integer" },
      mode: { enum: ["fast", "full"] },
      nested: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
      labels: { type: "array", items: { type: "string" } },
      nullable: { type: ["string", "null"] }
    },
    required: ["query", "nested", "labels", "nullable"],
    additionalProperties: false
  },
  sideEffect: "read",
  execute(input) {
    const query: string = input.query;
    const count: number | undefined = input.count;
    const mode: "fast" | "full" | undefined = input.mode;
    const enabled: boolean = input.nested.enabled;
    const labels: string[] = input.labels;
    const nullable: string | null = input.nullable;
    // @ts-expect-error unknown properties are not inferred
    input.missing;
    // @ts-expect-error strings do not become numbers
    const invalid: number = input.query;
    return { query, count, mode, enabled, labels, nullable };
  }
});
type Input = Parameters<typeof inferred.execute>[0];
const valid: Input = { query: "ok", nested: { enabled: true }, labels: [], nullable: null };
// @ts-expect-error required nested field cannot be omitted
const missing: Input = { query: "ok", labels: [], nullable: null };
// @ts-expect-error enum values are not arbitrary strings
const badEnum: Input = { ...valid, mode: "invalid" };
// @ts-expect-error array element types are enforced
const badArray: Input = { ...valid, labels: [1] };
void [missing, badEnum, badArray];
type Ref = SchemaInput<{ $ref: "#/$defs/A" }>;
const ref: Ref = {};
void ref;

test("literal JSON Schema types preserve the canonical wire schema", () => {
  assert.equal(inferred.inputSchema.type, "object");
  assert.deepEqual(inferred.inputSchema.required, ["query", "nested", "labels", "nullable"]);
});
