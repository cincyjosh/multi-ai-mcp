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
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    function fail(err: Error): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
      reject(err);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_BUFFER_BYTES) {
        fail(new Error(`${command} stdout exceeded ${MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_BUFFER_BYTES) {
        fail(new Error(`${command} stderr exceeded ${MAX_BUFFER_BYTES} bytes`));
        return;
      }
      stderrChunks.push(chunk);
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin, "utf-8");
    }
    child.stdin.end();

    const timer = setTimeout(() => {
      fail(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      fail(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code !== 0 || signal) {
        const errText = Buffer.concat(stderrChunks).toString().trim();
        const detail = signal ? `signal ${signal}` : `code ${code}`;
        reject(new Error(`${command} exited with ${detail}: ${errText}`));
      } else {
        const stderrText = Buffer.concat(stderrChunks).toString().trim();
        if (stderrText) {
          console.error(`[run_cli] ${command} stderr: ${stderrText}`);
        }
        resolve(Buffer.concat(stdoutChunks).toString());
      }
    });
  });
}
