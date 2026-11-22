/**
 * @agentic-tools/cli — programmatic entry points behind the CLI binary.
 */

export { detectCapabilities, renderReport } from "./doctor.js";
export type { CapabilityReport } from "./doctor.js";
export { loadToolkit, configWarnings } from "./config.js";
