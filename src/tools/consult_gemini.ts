import { resolveDirectorySafe } from "../utils/file_reader.js";
import { runCli, RunCliOptions } from "../utils/run_cli.js";
import { buildFileContext } from "../utils/prompt_builder.js";

// Cache of session IDs established in this process to skip the try-catch
// on subsequent calls. Capped at MAX_SESSIONS; oldest entry evicted when full.
// Correctness does not depend on this Set — it's a fast path only.
const MAX_SESSIONS = 1000;
const geminiSessions = new Set<string>();

function markSessionEstablished(sessionId: string): void {
  if (geminiSessions.size >= MAX_SESSIONS) {
    const oldest = geminiSessions.values().next().value;
    if (oldest !== undefined) geminiSessions.delete(oldest);
  }
  geminiSessions.add(sessionId);
}

async function runGeminiWithSession(
  bin: string,
  baseArgs: string[],
  sessionId: string,
  opts: RunCliOptions
): Promise<string> {
  if (geminiSessions.has(sessionId)) {
    // Fast path: known existing session
    const res = await runCli(bin, [...baseArgs, "--resume", sessionId], opts);
    return res.stdout;
  }

  // Slow path: try to create the session; fall back to resume if it already
  // exists (e.g. after a server restart that cleared the in-process Set).
  try {
    const result = await runCli(bin, [...baseArgs, "--session-id", sessionId], opts);
    markSessionEstablished(sessionId);
    return result.stdout;
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      const result = await runCli(bin, [...baseArgs, "--resume", sessionId], opts);
      markSessionEstablished(sessionId);
      return result.stdout;
    }
    throw err;
  }
}

export async function consultGemini(params: {
  prompt: string;
  files?: string[];
  directory?: string;
  sessionId?: string;
  timeoutMs?: number;
}): Promise<{ response: string; sessionId: string }> {
  const { prompt: fileContextPrompt, directories } = await buildFileContext(
    params.files ?? []
  );

  const stdinContent = fileContextPrompt
    ? `${params.prompt}\n\n${fileContextPrompt}`
    : params.prompt;

  const bin = process.env.GEMINI_BIN ?? "gemini";
  const dirArgs: string[] = [];
  if (params.directory) {
    const validatedDir = await resolveDirectorySafe(params.directory);
    dirArgs.push("--include-directories", validatedDir);
  }
  // Add directories from individual files
  for (const dir of directories) {
    dirArgs.push("--include-directories", dir);
  }

  const baseArgs = [
    "-p",
    "-",
    "-o",
    "text",
    "--skip-trust",
    "--approval-mode",
    "plan",
    ...dirArgs,
  ];

  const timeoutMs = params.timeoutMs ?? (params.directory ? 600_000 : 300_000);

  let response: string;
  if (params.sessionId) {
    response = await runGeminiWithSession(bin, baseArgs, params.sessionId, {
      stdin: stdinContent,
      timeoutMs,
    });
  } else {
    const res = await runCli(bin, baseArgs, { stdin: stdinContent, timeoutMs });
    response = res.stdout;
  }

  return { response: response.trim(), sessionId: params.sessionId ?? "" };
}
