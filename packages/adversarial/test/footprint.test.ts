import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createToolkit } from "@agentic-tools/runtime";
import { bash } from "@agentic-tools/bash";
import { filesystem } from "@agentic-tools/filesystem";
import { git } from "@agentic-tools/git";
import { web } from "@agentic-tools/web";

// PRD section 16 (context efficiency): token footprint of each package's
// default tool set is tracked, and growth beyond the budget fails CI.
// Budgets include headroom over measured values. Raise one deliberately, in
// review, when a default set legitimately grows; never to silence a failure.
// Token counts are the runtime's approximate estimate, not a model tokenizer.
const BUDGETS: Record<string, number> = {
  filesystem: 680,
  git: 480,
  web: 100,
  bash: 140
};

const workspace = () => mkdtempSync(join(tmpdir(), "at-footprint-"));
const defaults: Record<string, () => ReturnType<typeof filesystem>> = {
  filesystem: () => filesystem(),
  git: () => git(),
  web: () => web(),
  bash: () => bash({ mode: "trusted-host" } as never)
};

for (const [name, make] of Object.entries(defaults)) {
  test(`default ${name} tool set stays within its token budget`, () => {
    const toolkit = createToolkit({ workspace: workspace(), tools: make() });
    const fp = toolkit.describeFootprint();
    assert.ok(fp.totalTokens > 0);
    assert.ok(
      fp.totalTokens <= BUDGETS[name]!,
      `${name} default footprint ${fp.totalTokens} exceeds budget ${BUDGETS[name]}`
    );
  });
}

test("package defaults are read-only except where explicitly documented", () => {
  const fs = filesystem().map((t) => t.sideEffect);
  assert.ok(fs.every((s) => s === "read"), "filesystem default set must be read-only");
  const g = git().map((t) => t.sideEffect);
  assert.ok(g.every((s) => s === "read"), "git default set must be read-only");
});
