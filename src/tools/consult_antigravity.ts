import { resolveDirectorySafe } from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";
import { buildFileContext } from "../utils/prompt_builder.js";

export async function consultAntigravity(params: {
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

  const bin = process.env.ANTIGRAVITY_BIN ?? process.env.AGY_BIN ?? process.env.GEMINI_BIN ?? "agy";
  const dirArgs: string[] = [];
  if (params.directory) {
    const validatedDir = await resolveDirectorySafe(params.directory);
    dirArgs.push("--add-dir", validatedDir);
  }
  for (const dir of directories) {
    dirArgs.push("--add-dir", dir);
  }

  const baseArgs = [
    "-p",
    stdinContent,
    "--dangerously-skip-permissions",
    ...dirArgs,
  ];

  if (params.sessionId) {
    baseArgs.push("--conversation", params.sessionId);
  }

  const timeoutMs = params.timeoutMs ?? (params.directory || directories.length > 0 ? 600_000 : 300_000);

  const res = await runCli(bin, baseArgs, { stdin: stdinContent, timeoutMs });
  return { response: res.stdout.trim(), sessionId: params.sessionId ?? "" };
}

/**
 * @deprecated Use consultAntigravity instead.
 */
export async function consultGemini(params: {
  prompt: string;
  files?: string[];
  directory?: string;
  sessionId?: string;
  timeoutMs?: number;
}): Promise<{ response: string; sessionId: string }> {
  console.warn(
    "[multi-ai-mcp] consult_gemini is deprecated and has been replaced by consult_antigravity. Please update your MCP client configuration."
  );
  return consultAntigravity(params);
}
