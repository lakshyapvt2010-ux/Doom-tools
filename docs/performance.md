# Local runtime baseline

Measured November 23, 2026 on one shared Linux development environment. Run
`node scripts/benchmark-runtime.mjs` after building. Default: 200 warm-up calls,
then 2,000 sequential small JSON echo invocations through the runtime.

| Node | Mean ms | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: |
| 22.23.5 | 0.0572 | 0.0473 | 0.0743 | 0.3933 |
| 24.22.3 | 0.0422 | 0.0310 | 0.0633 | 0.1530 |
| 26.13.1 | 0.0384 | 0.0281 | 0.0582 | 0.1775 |

The measurement includes warm schema validation, input snapshot, permission
checks, redaction, traces, audit and result budgets. It excludes registration,
package startup, filesystem/Git/network/container work, model inference,
concurrent load and hosted deployment. These are baseline observations, not
performance guarantees or a meaningful ranking between Node versions. Shared
CPU contention, warm caches and garbage collection can change results. No
release threshold or service-level target is chosen from a single measurement.
