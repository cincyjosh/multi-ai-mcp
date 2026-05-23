import { spawn } from "child_process";

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

export interface RunCliOptions {
  timeoutMs?: number;
  idleTimeoutMs?: number;
  stdin?: string;
}

export function runCli(
  command: string,
  args: string[],
  options: RunCliOptions = {}
): Promise<string> {
  const { timeoutMs = 120_000, idleTimeoutMs, stdin } = options;

  return new Promise((resolve, reject) => {
    // detached=true creates a new process group on Unix so that a kill of
    // -pid reaches the child AND any subprocesses it may have spawned.
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    // State machine: running → failing (on timeout/idle/buffer) → closed
    // Resolution always happens from the close handler so the Promise does not
    // settle until the child process has actually exited. This prevents races
    // between session-state mutations, temp-dir cleanup, and semaphore release.
    let state: "running" | "failing" | "closed" = "running";
    let pendingError: Error | undefined;

    let timer: ReturnType<typeof setTimeout>;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    function killProcess(sig: NodeJS.Signals): void {
      try {
        if (process.platform !== "win32" && child.pid !== undefined) {
          // Negative PID targets the entire process group
          process.kill(-child.pid, sig);
        } else {
          child.kill(sig);
        }
      } catch { /* process may have already exited */ }
    }

    function fail(err: Error): void {
      if (state !== "running") return;
      state = "failing";
      pendingError = err;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      killProcess("SIGTERM");
      killTimer = setTimeout(() => killProcess("SIGKILL"), 3000);
      // Resolution deferred to close handler so callers see the process as
      // truly gone before the Promise settles.
    }

    function resetIdleTimer(): void {
      if (!idleTimeoutMs) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(new Error(`${command} idle timeout: no output for ${idleTimeoutMs}ms`));
      }, idleTimeoutMs);
    }

    if (idleTimeoutMs) resetIdleTimer();

    child.stdout.on("data", (chunk: Buffer) => {
      if (state !== "running") return;
      resetIdleTimer();
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_BUFFER_BYTES) {
        fail(new Error(`${command} stdout exceeded ${MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (state !== "running") return;
      resetIdleTimer();
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_BUFFER_BYTES) {
        fail(new Error(`${command} stderr exceeded ${MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stderrChunks.push(chunk);
    });

    // Attach error handler unconditionally — even child.stdin.end() can fail.
    child.stdin.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EPIPE") fail(err);
      // EPIPE: child already exited — close handler will report the real error
    });
    if (stdin !== undefined) {
      child.stdin.end(stdin, "utf-8");
    } else {
      child.stdin.end();
    }

    timer = setTimeout(() => {
      fail(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      // Spawn-level errors (e.g. ENOENT) may not produce a close event, so
      // reject immediately and mark closed to prevent double-resolution.
      if (state === "closed") return;
      state = "closed";
      clearTimeout(timer);
      clearTimeout(idleTimer);
      clearTimeout(killTimer);
      if (err.code === "ENOENT") {
        reject(new Error(`${command} not found — is it installed and on your PATH?`));
      } else {
        reject(err);
      }
    });

    child.on("close", (code, signal) => {
      if (state === "closed") return;
      state = "closed";
      clearTimeout(timer);
      clearTimeout(idleTimer);
      clearTimeout(killTimer);

      if (pendingError) {
        reject(pendingError);
        return;
      }

      if (code !== 0 || signal) {
        const raw = Buffer.concat(stderrChunks).toString("utf8").trim();
        const errText = raw.length > 500 ? raw.slice(0, 500) + " …[truncated]" : raw;
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        reject(new Error(`${command} exited with ${detail}: ${errText}`));
      } else {
        const raw = Buffer.concat(stderrChunks).toString("utf8").trim();
        if (raw) {
          const stderrText = raw.length > 200 ? raw.slice(0, 200) + " …[truncated]" : raw;
          console.error(`[run_cli] ${command} stderr: ${stderrText}`);
        }
        resolve(Buffer.concat(stdoutChunks).toString("utf8"));
      }
    });
  });
}
