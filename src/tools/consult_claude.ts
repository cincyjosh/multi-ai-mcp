import { constants, mkdtemp, open, rm, writeFile } from "fs/promises";
import { extname, join } from "path";
import { tmpdir } from "os";
import { resolveDirectorySafe } from "../utils/file_reader.js";
import {
  resolveImagePathSafe,
  MAX_IMAGE_BYTES,
  O_NOFOLLOW,
} from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";
import { buildFileContext } from "../utils/prompt_builder.js";

// Cache of session IDs established in this process. Capped at MAX_SESSIONS.
const MAX_SESSIONS = 1000;
const claudeSessions = new Set<string>();

function markSessionEstablished(sessionId: string): void {
  if (claudeSessions.size >= MAX_SESSIONS) {
    const oldest = claudeSessions.values().next().value;
    if (oldest !== undefined) claudeSessions.delete(oldest);
  }
  claudeSessions.add(sessionId);
}

export async function consultClaude(params: {
  prompt: string;
  files?: string[];
  images?: string[];
  directory?: string;
  sessionId?: string;
  timeoutMs?: number;
}): Promise<{ response: string; sessionId: string }> {
  const fileContext = await buildFileContext(params.files ?? []);

  let stdinContent = fileContext
    ? `${params.prompt}\n\n${fileContext}`
    : params.prompt;

  const bin = process.env.CLAUDE_BIN ?? "claude";
  const baseArgs = ["--print", "--output-format", "text"];
  const addDirs: string[] = [];
  const tmpDir = params.images?.length
    ? await mkdtemp(join(tmpdir(), "claude-img-"))
    : undefined;

  try {
    if (params.directory) {
      addDirs.push(await resolveDirectorySafe(params.directory));
    }

    if (params.images && tmpDir) {
      const imagePaths: string[] = [];
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
        imagePaths.push(tmpImg);
      }

      addDirs.push(tmpDir);
      stdinContent += `\n\nAttached images:\n${imagePaths.map((p) => `- ${p}`).join("\n")}`;
    }

    const finalArgs = [...baseArgs];
    if (addDirs.length > 0) {
      finalArgs.push("--add-dir", ...addDirs);
    }

    const timeoutMs = params.timeoutMs ?? (params.directory ? 600_000 : 300_000);
    let response: string;

    if (params.sessionId) {
      if (claudeSessions.has(params.sessionId)) {
        const res = await runCli(bin, [...finalArgs, "--resume", params.sessionId], { stdin: stdinContent, timeoutMs });
        response = res.stdout;
      } else {
        try {
          const res = await runCli(bin, [...finalArgs, "--session-id", params.sessionId], { stdin: stdinContent, timeoutMs });
          markSessionEstablished(params.sessionId);
          response = res.stdout;
        } catch (err: any) {
          if (err.message?.includes("already in use")) {
            const res = await runCli(bin, [...finalArgs, "--resume", params.sessionId], { stdin: stdinContent, timeoutMs });
            markSessionEstablished(params.sessionId);
            response = res.stdout;
          } else {
            throw err;
          }
        }
      }
    } else {
      const res = await runCli(bin, [...finalArgs, "--no-session-persistence"], { stdin: stdinContent, timeoutMs });
      response = res.stdout;
    }

    return { response: response.trim(), sessionId: params.sessionId ?? "" };
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
        console.error(`[consult_claude] failed to clean up ${tmpDir}:`, err);
      });
    }
  }
}
