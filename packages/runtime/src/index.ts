/**
 * @agentic-tools/runtime — invocation lifecycle, registry, selection
 * enforcement, output shaping, tracing (PRD 8.2, 8.5, 8.6).
 */

export { createToolkit } from "./toolkit.js";
export type { Toolkit, ToolkitOptions } from "./toolkit.js";

export { ToolRegistry } from "./registry.js";
export { classifyInvocation, invokeTool } from "./invoke.js";
export type { InvokeOptions } from "./invoke.js";
export { estimateTokens, shapeResult, toolFootprintTokens } from "./shaping.js";
export { narrowSelection } from "./state.js";
export type { SelectionCriteria, ToolkitState } from "./state.js";
export { TraceCollector } from "./trace.js";
export type { TraceRecord } from "./trace.js";
export { MetricsCollector } from "./metrics.js";
export type { MetricRecord } from "./metrics.js";
export { scopeServices } from "./services.js";

export { boundResult, assertResultBudget } from "./envelope.js";
export type { ResultBudget, ResultEncoder } from "./envelope.js";
