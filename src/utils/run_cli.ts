import { spawn } from "child_process";

interface RunCliOptions {
  timeoutMs?: number;
}

export function runCli(
  command: string,
  args: string[],
  options: RunCliOptions = {}
): Promise<string> {
  const { timeoutMs = 120_000 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const errText = Buffer.concat(stderr).toString().trim();
        reject(new Error(`${command} exited with code ${code}: ${errText}`));
      } else {
        resolve(Buffer.concat(stdout).toString());
      }
    });
  });
}
