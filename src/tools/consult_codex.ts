import { mkdtemp, open, readFile, rm, stat, writeFile, constants } from "fs/promises";
import { extname, join } from "path";
import { tmpdir } from "os";
import {
  resolveDirectorySafe,
  resolveImagePathSafe,
  MAX_IMAGE_BYTES,
  O_NOFOLLOW,
} from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";
import { buildFileContext } from "../utils/prompt_builder.js";

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10 MB

// Maps caller-supplied sessionId → Codex-internal session UUID.
// Cleared on process restart; intentionally in-process only.
// Capped at MAX_SESSIONS entries; oldest entry evicted when full.
const MAX_SESSIONS = 1000;
const codexSessions = new Map<string, string>();

function storeSession(callerId: string, codexId: string): void {
  if (codexSessions.size >= MAX_SESSIONS) {
    const oldest = codexSessions.keys().next().value;
    if (oldest !== undefined) codexSessions.delete(oldest);
  }
  codexSessions.set(callerId, codexId);
}

// --- Session discovery via stderr scraping ---
//
// Codex auto-generates session IDs and prints them to stderr during exec.
// We capture stderr and scrape the ID to associate it with the caller's sessionId.

function scrapeSessionId(stderr: string): string | undefined {
  const match = stderr.match(/(?:session id|session review): ([a-f0-9-]{36})/i);
  return match ? match[1] : undefined;
}

export async function consultCodex(params: {
  prompt: string;
  files?: string[];
  images?: string[];
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

  const tmpDir = await mkdtemp(join(tmpdir(), "codex-out-"));
  const outputFile = join(tmpDir, "response.txt");

  try {
    const bin = process.env.CODEX_BIN ?? "codex";
    let returnedSessionId = "";

    // Build directory args (shared between all paths)
    const dirArgs: string[] = [];
    if (params.directory) {
      const validatedDir = await resolveDirectorySafe(params.directory);
      dirArgs.push("-C", validatedDir);
    }
    // Add directories from individual files
    for (const dir of directories) {
      dirArgs.push("--add-dir", dir);
    }

    // Build image args (shared between all paths)
    const imageArgs: string[] = [];
    if (params.images) {
      for (let i = 0; i < params.images.length; i++) {
        const img = params.images[i];
        const validated = await resolveImagePathSafe(img);
        const ext = extname(validated);
        const tmpImg = join(tmpDir, `image-${i}${ext}`);
        const imgFd = await open(validated, constants.O_RDONLY | O_NOFOLLOW);
        try {
          const fdInfo = await imgFd.stat();
          if (!fdInfo.isFile() || fdInfo.size > MAX_IMAGE_BYTES) {
            throw new Error(`Image failed post-open validation: ${img}`);
          }
          await writeFile(tmpImg, await imgFd.readFile());
        } finally {
          await imgFd.close();
        }
        imageArgs.push("-i", tmpImg);
      }
    }

    const timeoutMs = params.timeoutMs ?? (params.directory || directories.length > 0 ? 600_000 : 300_000);

    if (params.sessionId) {
      const existingCodexId = codexSessions.get(params.sessionId);

      if (existingCodexId) {
        // Resume existing session: Omit dirArgs as codex maintains context
        const args = [
          "exec", "resume", existingCodexId, "-",
          "--skip-git-repo-check",
          "-o", outputFile,
          ...imageArgs,
        ];
        await runCli(bin, args, { stdin: stdinContent, timeoutMs });
        returnedSessionId = params.sessionId;
      } else {
        // New named session: scrape ID from stderr
        const args = [
          ...dirArgs,
          "exec", "-",
          "--skip-git-repo-check",
          "-o", outputFile,
          ...imageArgs,
        ];
        const result = await runCli(bin, args, { stdin: stdinContent, timeoutMs });
        const codexId = scrapeSessionId(result.stderr);
        if (!codexId) {
          throw new Error("Codex did not output a session ID to stderr");
        }
        storeSession(params.sessionId, codexId);
        returnedSessionId = params.sessionId;
      }
    } else {
      // Stateless (ephemeral) — original behaviour
      const args = [
        ...dirArgs,
        "exec", "-",
        "--skip-git-repo-check",
        "--ephemeral",
        "-o", outputFile,
        ...imageArgs,
      ];
      await runCli(bin, args, { stdin: stdinContent, timeoutMs });
    }

    let fileSize: number;
    try {
      fileSize = (await stat(outputFile)).size;
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error("codex completed but produced no output file");
      }
      throw err;
    }
    if (fileSize > MAX_OUTPUT_BYTES) {
      throw new Error(`codex output exceeded size limit (${fileSize} bytes)`);
    }
    const response = (await readFile(outputFile, "utf-8")).trim();
    return { response, sessionId: returnedSessionId };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
      console.error(`[consult_codex] failed to clean up ${tmpDir}:`, err);
    });
  }
}
