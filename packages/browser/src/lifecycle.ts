import type { ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";

/** Wait for Chrome to stop writing before deleting its temporary profile. */
async function stopChrome(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let hardLimit: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      clearTimeout(grace);
      clearTimeout(hardLimit);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    const onError = (error: Error) => finish(error);
    child.once("exit", onExit);
    child.once("error", onError);
    const grace = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch (error) { finish(error as Error); return; }
      hardLimit = setTimeout(() => finish(new Error("Chrome did not exit after SIGKILL")), 2000);
    }, 2000);
    try { child.kill("SIGTERM"); } catch (error) { finish(error as Error); }
  });
}

/** Internal, shared by normal close and failed launch paths. */
export function createBrowserCleanup(child: ChildProcess, profile: string, disconnect: () => void, removeProfile: typeof rm = rm): () => Promise<void> {
  let closing: Promise<void> | undefined;
  const onProcessExit = () => { try { child.kill("SIGKILL"); } catch { /* best effort during process exit */ } };
  process.once("exit", onProcessExit);
  return () => closing ??= (async () => {
    try { disconnect(); } catch { /* a socket may already be closed */ }
    await stopChrome(child);
    process.removeListener("exit", onProcessExit);
    // Chrome helpers can briefly retain profile files after the main process
    // exits, especially on macOS. Retry known transient fs errors, not all errors.
    await removeProfile(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  })();
}
