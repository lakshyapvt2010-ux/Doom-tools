/**
 * Line-based unified diff for filesystem.diff (no external dependency).
 * LCS dynamic programming, capped for very large inputs.
 */

const MAX_CELLS = 4_000_000; // rows*cols cap; larger inputs fall back

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

/** Compute the line edit script between two texts. */
export function diffLines(aText: string, bText: string): DiffLine[] {
  const a = aText.split("\n");
  const b = bText.split("\n");
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    throw new Error(
      `Inputs too large for the built-in diff (${a.length} vs ${b.length} lines). Use git.diff for repository files.`
    );
  }
  // LCS lengths table.
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Uint32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * cols + j] =
        a[i] === b[j]
          ? (dp[(i + 1) * cols + j + 1] ?? 0) + 1
          : Math.max(dp[(i + 1) * cols + j] ?? 0, dp[i * cols + (j + 1)] ?? 0);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: "context", text: a[i] as string });
      i++;
      j++;
    } else if ((dp[(i + 1) * cols + j] ?? 0) >= (dp[i * cols + (j + 1)] ?? 0)) {
      out.push({ type: "remove", text: a[i] as string });
      i++;
    } else {
      out.push({ type: "add", text: b[j] as string });
      j++;
    }
  }
  while (i < a.length) out.push({ type: "remove", text: a[i++] as string });
  while (j < b.length) out.push({ type: "add", text: b[j++] as string });
  return out;
}

/** Render an edit script as unified-diff-like text. */
export function renderUnified(lines: DiffLine[], aName: string, bName: string): string {
  const header = `--- ${aName}\n+++ ${bName}\n`;
  const body = lines
    .map((l) => (l.type === "context" ? " " : l.type === "add" ? "+" : "-") + l.text)
    .join("\n");
  return header + body + (body.endsWith("\n") ? "" : "\n");
}

/** True when the two texts differ only in ways diffLines reports. */
export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.type !== "context");
}
