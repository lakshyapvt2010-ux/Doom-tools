/** Linux Docker isolation for shell execution. The Docker daemon is trusted.
 * Never mounts the daemon socket, home directory or host credentials.
 * Resource limits and isolation flags are mandatory, not best-effort. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { ToolError, defineTool, success, type ToolDefinition } from "@agentic-tools/core";

export interface DockerOptions {
  mode: "sandboxed-local";
  /** Locally installed image pinned by its registry SHA-256 digest. Never pulled implicitly. */
  image: string;
  /** Host-trusted executable path; for managed Docker installations and test doubles. */
  executable?: string;
  /** Non-root numeric container identity. Defaults to 1000:1000. */
  user?: string;
  memoryMb?: number;
  cpus?: number;
  pidsLimit?: number;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
}
interface RunResult { code: number | null; stdout: string; stderr: string; omitted: number; }
function capture(command: string, args: string[], cap: number, signal?: AbortSignal, timeout = 30_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    // Deliberately ignore DOCKER_HOST/CONTEXT/TLS and other ambient redirection.
    for (const key of ["PATH", "HOME", "TMPDIR", "LANG"]) if (process.env[key] !== undefined) env[key] = process.env[key];
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env, signal, timeout, killSignal: "SIGKILL" });
    const streams: Buffer[][] = [[], []]; const sizes = [0, 0]; let omitted = 0;
    const collect = (i: number, chunk: Buffer) => {
      const keep = Math.min(chunk.length, Math.max(0, cap - sizes[i]!));
      streams[i]!.push(chunk.subarray(0, keep)); sizes[i]! += keep; omitted += chunk.length - keep;
    };
    child.stdout.on("data", (c: Buffer) => collect(0, c)); child.stderr.on("data", (c: Buffer) => collect(1, c));
    child.on("error", () => reject(new ToolError(signal?.aborted ? "cancelled" : "execution_error", "Docker could not complete the operation.")));
    child.on("close", code => resolve({ code, stdout: Buffer.concat(streams[0]!).toString("utf8"), stderr: Buffer.concat(streams[1]!).toString("utf8"), omitted }));
  });
}
function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
  return value;
}

export function dockerShell(options: DockerOptions): ToolDefinition[] {
  if (options.mode !== "sandboxed-local") throw new Error("Explicit sandboxed-local mode is required.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:/-]*@sha256:[a-f0-9]{64}$/.test(options.image)) throw new Error("Docker image must be pinned by its SHA-256 registry digest.");
  const user = options.user ?? "1000:1000";
  if (!/^[1-9][0-9]*:[0-9]+$/.test(user)) throw new Error("Docker user must be a non-root numeric UID:GID.");
  const memory = positive(options.memoryMb ?? 256, "memoryMb");
  const pids = positive(options.pidsLimit ?? 64, "pidsLimit");
  const timeout = positive(options.maxTimeoutMs ?? 120_000, "maxTimeoutMs");
  const cap = positive(options.maxOutputBytes ?? 65_536, "maxOutputBytes");
  const cpus = options.cpus ?? 1;
  if (!Number.isFinite(cpus) || cpus <= 0) throw new Error("cpus must be positive and finite.");
  const executable = options.executable ?? "docker";
  const tool = defineTool({
    name: "docker.execute", description: "Run shell in an isolated Linux Docker container. Workspace is writable; no network or host credentials. Requires approval.",
    inputSchema: { type: "object", properties: { command: { type: "string", minLength: 1 }, timeoutMs: { type: "integer", minimum: 1 } }, required: ["command"], additionalProperties: false },
    sideEffect: "destructive", risk: "high", capabilities: ["process.execute", "filesystem.write"], tags: ["shell", "docker"],
    classify: () => ({ sideEffect: "destructive", risk: "high", capabilities: [{ name: "process.execute" }, { name: "filesystem.write", path: "." }] }),
    async execute(input, ctx) {
      if (process.platform !== "linux") throw new ToolError("execution_error", "Docker shell currently requires a Linux host; no host-shell fallback is provided.");
      if (ctx.signal.aborted) throw new ToolError("cancelled", "Docker call cancelled before launch.");
      const workspace = realpathSync(ctx.workspace);
      if (!statSync(workspace).isDirectory() || /[,\r\n]/.test(workspace)) throw new ToolError("validation", "Workspace is not a supported Docker bind-mount directory.");
      const name = "agentic-" + randomUUID();
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      const ms = Math.min(input.timeoutMs ?? timeout, timeout, Math.max(1, (ctx.deadline ?? Date.now() + timeout) - Date.now()));
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
      ctx.signal.addEventListener("abort", cancel, { once: true });
      if (ctx.signal.aborted) cancel();
      let result: RunResult | undefined; let failed: unknown;
      try {
        result = await capture(executable, ["--host", "unix:///var/run/docker.sock", "run", "--name", name, "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges:true", "--pids-limit", String(pids), "--memory", `${memory}m`, "--memory-swap", `${memory}m`, "--cpus", String(cpus), "--user", user, "--ipc=private", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m", "--mount", `type=bind,src=${workspace},dst=/workspace`, "--workdir", "/workspace", "--env", "HOME=/tmp", "--entrypoint", "/bin/sh", options.image, "-c", input.command], cap, controller.signal, ms);
      } catch (error) { failed = error; }
      finally {
        clearTimeout(timer); ctx.signal.removeEventListener("abort", cancel);
        // Always attempt independent teardown, even after the caller aborts.
        const cleanup = await capture(executable, ["--host", "unix:///var/run/docker.sock", "rm", "--force", name], 4096, undefined, 10_000).catch(() => null);
        // --rm normally removed it already. Confirm absence rather than trusting rm's exit code.
        const inspect = await capture(executable, ["--host", "unix:///var/run/docker.sock", "ps", "--all", "--filter", `name=^/${name}$`, "--format", "{{.ID}}"], 4096, undefined, 10_000).catch(() => null);
        if (!inspect || inspect.code !== 0 || inspect.stdout.trim()) throw new ToolError("execution_error", "Docker cleanup could not be verified. Inspect the Docker daemon before more work.");
        void cleanup;
      }
      if (timedOut) throw new ToolError("timeout", "Docker command timed out; container cleanup was verified.");
      if (ctx.signal.aborted) throw new ToolError("cancelled", "Docker command cancelled; container cleanup was verified.");
      if (failed) throw failed;
      if (!result || result.code === 125 || result.code === 126 || result.code === 127) throw new ToolError("execution_error", "Docker refused the container or could not start its shell. No host fallback was used.");
      return success({ name: "docker.execute", version: "0.0.0" }, { exitCode: result.code, stdout: result.stdout, stderr: result.stderr }, result.omitted ? { truncation: { truncated: true, unit: "bytes", omitted: result.omitted, continuation: "Narrow the command output or raise the configured stream cap." } } : {});
    }
  });
  return [tool as ToolDefinition];
}
