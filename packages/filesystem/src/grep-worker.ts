/**
 * Isolated grep scanner (resource-DoS bound).
 *
 * User-supplied regular expressions can catastrophically backtrack and
 * block the Node event loop for unbounded time, which would defeat the
 * runtime timeout. The scan therefore runs in a worker thread that the
 * parent terminates on timeout/cancellation. The parent enforces the
 * wall-clock bound; this file only compiles and scans.
 */

import { parentPort, workerData } from "node:worker_threads";

export interface GrepFileLines {
  path: string;
  lines: string[];
}

export interface GrepJob {
  pattern: string;
  ignoreCase: boolean;
  files: GrepFileLines[];
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

const job = workerData as GrepJob;
const regex = new RegExp(job.pattern, job.ignoreCase ? "i" : "");
const matches: GrepMatch[] = [];
for (const file of job.files) {
  for (let i = 0; i < file.lines.length; i++) {
    const line = file.lines[i] as string;
    regex.lastIndex = 0;
    if (regex.test(line)) {
      matches.push({ path: file.path, line: i + 1, text: line });
    }
  }
}
parentPort?.postMessage({ matches });
