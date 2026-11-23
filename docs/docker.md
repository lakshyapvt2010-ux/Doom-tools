# Docker shell (P1, limited real-container validation)

`@agentic-tools/docker` is an explicit opt-in tool factory, separate from host
Bash. It is not a substitute for a completed security review. Real Linux container acceptance passed in
[run17](https://github.com/MRIARC-08/tch-/actions/runs/45189379629). Local executable-double
tests check arguments and failure handling, not kernel isolation. The published
npm alpha excludes this package.

```ts
import { dockerShell } from '@agentic-tools/docker';
const tools = dockerShell({
  mode: 'sandboxed-local',
  image: 'your-image@sha256:<64-hex-registry-digest>',
  user: '1000:1000'
});
```

The Linux host must provide a trusted Docker daemon at
`unix:///var/run/docker.sock`. Images must already be installed and pinned by
digest. No image is pulled by a tool invocation. The image must contain
`/bin/sh`. Workspace permissions must permit the configured non-root identity.

Every call remains destructive/high and approval-gated. It requests
`process.execute` and a filesystem write grant for the workspace. The container
gets one writable bind mount at `/workspace`, a size-limited noexec temporary
filesystem, a read-only root, no network interface beyond loopback, a non-root
UID, no additional capabilities and no-new-privileges. CPU, memory/swap and PID
limits are mandatory. Docker refusing a limit fails the operation, with no host
shell fallback. The Docker socket, home directory and host environment secrets
are not mounted or passed to the container.

Timeout and cancellation stop the client and independently force-remove the
named container, then check for its absence. A failed cleanup check returns an
error asking the operator to inspect the daemon. Runtime cancellation can stop
waiting before that teardown finishes. Daemon failure or delayed container
creation can prevent a cleanup guarantee. Verify daemon state after any such
failure before resuming work.

The entire workspace is writable and visible to the command. Do not place
secrets there. Container outputs remain untrusted data. Container isolation
shares the host kernel and trusts the daemon, image and host configuration.
No claim is made for privileged-daemon compromise, kernel vulnerabilities,
host-side symlink races, Windows/macOS Docker hosts, remote daemons, nested
containers, GPU devices or arbitrary network allowlists.

Run the real acceptance script only in an authorized Docker-capable environment:

```sh
AGENTIC_DOCKER_IMAGE='alpine@sha256:<installed-digest>' node scripts/check-docker-integration.mjs
```

It checks real invocation, workspace writes, non-root identity, read-only root,
absence of host paths/socket, no external interface, timeout/cancellation and
remaining containers. Passing it is evidence for those checks, not proof of an
escape-free sandbox or independent security review.
