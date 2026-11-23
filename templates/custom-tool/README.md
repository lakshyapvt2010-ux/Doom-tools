# Private local custom-tool starter

This template runs a typed custom tool without a hosted model, network provider
or published package. No secret is required. It is private and has no selected
open-source license. Copy it into a new folder, not over an existing project.

Until the packages are released, `vendor/*.tgz` must contain the local packed
core, runtime and security packages. From a built repository, the reproducible
check below packs those packages, copies this starter to a temporary independent
project, installs the artifacts, compiles strict TypeScript and runs it:

```bash
pnpm build
node scripts/check-local-install.mjs
```

The check leaves the independent project in its printed temporary path for
inspection. Its only network use is installing the declared dependencies from
the npm registry if not cached. It does not publish anything or execute a model.
For your own tool, replace the canonical schema and handler in `src/index.ts`.
Inferred input types are convenient; runtime validation and policy still matter.
