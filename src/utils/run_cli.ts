import { spawn } from "child_process";

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB

export interface RunCliOptions {
  timeoutMs?: number;
  stdin?: string;
}

export function runCli(
  command: string,
  args: string[],
  options: RunCliOptions = {}
): Promise<string> {
  const { timeoutMs = 120_000, stdin } = options;

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
    let settled = false;

    // Both timers declared before fail() so clearTimeout is always valid
    let timer: ReturnType<typeof setTimeout>;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

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
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      killProcess("SIGTERM");
      killTimer = setTimeout(() => killProcess("SIGKILL"), 3000);
      reject(err);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_BUFFER_BYTES) {
        fail(new Error(`${command} stdout exceeded ${MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_BUFFER_BYTES) {
        fail(new Error(`${command} stderr exceeded ${MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stderrChunks.push(chunk);
    });

    if (stdin !== undefined) {
      child.stdin.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "EPIPE") fail(err);
        // EPIPE: child already exited — close handler will report the real error
      });
      child.stdin.end(stdin, "utf-8");
    } else {
      child.stdin.end();
    }

    timer = setTimeout(() => {
      fail(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        fail(new Error(`${command} not found — is it installed and on your PATH?`));
      } else {
        fail(err);
      }
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (settled) return;
      settled = true;
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
