# Token footprint gate

PRD section 16 asks for per-package footprint tracking with regressions caught in CI. `packages/adversarial/test/footprint.test.ts` measures each package's default tool set with `toolkit.describeFootprint()` and fails when it exceeds a budget (measured value plus about 20 percent). It also asserts the filesystem and git defaults are statically read-only (FR-019).

Token counts are the runtime's approximate estimate, not a model tokenizer. Raise a budget only in review when a default set legitimately grows. Measured on this pass: filesystem 558, git 399, web 80, bash 114.
