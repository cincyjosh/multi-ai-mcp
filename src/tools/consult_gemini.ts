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
    return runCli(bin, [...baseArgs, "--resume", sessionId], opts);
  }

  // Slow path: try to create the session; fall back to resume if it already
  // exists (e.g. after a server restart that cleared the in-process Set).
  try {
    const result = await runCli(bin, [...baseArgs, "--session-id", sessionId], opts);
    markSessionEstablished(sessionId);
    return result;
  } catch (err: any) {
    if (err.message?.includes("already exists")) {
      const result = await runCli(bin, [...baseArgs, "--resume", sessionId], opts);
      markSessionEstablished(sessionId);
      return result;
    }
    throw err;
  }
}

export async function consultGemini(params: {
  prompt: string;
  files?: string[];
  sessionId?: string;
}): Promise<{ response: string; sessionId: string }> {
  const fileContext = await buildFileContext(params.files ?? []);

  const stdinContent = fileContext
    ? `${params.prompt}\n\n${fileContext}`
    : params.prompt;

  const bin = process.env.GEMINI_BIN ?? "gemini";
  const baseArgs = ["-p", "-", "-o", "text"];

  let raw: string;
  if (params.sessionId) {
    raw = await runGeminiWithSession(bin, baseArgs, params.sessionId, { stdin: stdinContent });
  } else {
    raw = await runCli(bin, baseArgs, { stdin: stdinContent });
  }

  return { response: raw.trim(), sessionId: params.sessionId ?? "" };
}
