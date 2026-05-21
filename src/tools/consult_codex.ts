import { mkdtemp, open, readFile, rm, stat, writeFile, constants } from "fs/promises";
import { extname, join } from "path";
import { tmpdir, homedir } from "os";
import {
  readFileContent,
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

// --- Session discovery via session_index.jsonl byte-offset diffing ---
//
// Codex auto-generates session IDs and records them in session_index.jsonl.
// We snapshot the file size BEFORE running exec, then read ONLY the newly
// appended bytes AFTER the run. This avoids loading the whole (potentially
// large) file and precisely scopes which entries belong to our run.
//
// A module-level mutex serialises concurrent new-session creations so that
// two simultaneous first-calls don't swap IDs via the external file.

function getSessionIndexPath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "session_index.jsonl");
}

async function getSessionIndexOffset(): Promise<number> {
  try {
    return (await stat(getSessionIndexPath())).size;
  } catch {
    return 0; // file doesn't exist yet (first ever codex session)
  }
}

const MAX_SESSION_INDEX_READ = 1024 * 1024; // 1 MB cap on newly appended bytes

async function readNewSessionIds(afterOffset: number): Promise<string[]> {
  const indexPath = getSessionIndexPath();
  let size: number;
  try {
    size = (await stat(indexPath)).size;
  } catch {
    return []; // file doesn't exist yet
  }
  if (size <= afterOffset) return [];

  const newBytes = size - afterOffset;
  // Validate before allocating — throws propagate to caller, not silently swallowed
  if (newBytes > MAX_SESSION_INDEX_READ) {
    throw new Error(
      `session_index.jsonl grew by ${newBytes} bytes in a single run — refusing to read`
    );
  }

  const fd = await open(indexPath, "r");
  try {
    const buf = Buffer.allocUnsafe(newBytes);
    await fd.read(buf, 0, buf.length, afterOffset);
    return buf
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const entry = JSON.parse(line);
          return typeof entry.id === "string" ? [entry.id] : [];
        } catch {
          return [];
        }
      });
  } finally {
    await fd.close();
  }
}

let _creationMutex = Promise.resolve();

async function discoverNewCodexSessionId(
  bin: string,
  execArgs: string[],
  opts: { stdin: string }
): Promise<string> {
  let discoveredId: string | undefined;

  // Acquire the creation lock to prevent two concurrent new-session runs from
  // reading each other's session_index.jsonl entries.
  let releaseNext!: () => void;
  const gate = new Promise<void>((r) => { releaseNext = r; });
  const prevMutex = _creationMutex;
  _creationMutex = prevMutex.then(() => gate, () => gate);

  try {
    await prevMutex.catch(() => {}); // wait; ignore previous error

    const beforeOffset = await getSessionIndexOffset();
    await runCli(bin, execArgs, opts);
    const newIds = await readNewSessionIds(beforeOffset);

    if (newIds.length === 1) {
      discoveredId = newIds[0];
    } else if (newIds.length === 0) {
      throw new Error(
        "Codex did not write a session entry — session_index.jsonl was not updated"
      );
    } else {
      throw new Error(
        `Ambiguous session: ${newIds.length} new Codex sessions appeared during the run`
      );
    }
  } finally {
    releaseNext();
  }

  return discoveredId!;
}

export async function consultCodex(params: {
  prompt: string;
  files?: string[];
  images?: string[];
  sessionId?: string;
}): Promise<{ response: string; sessionId: string }> {
  const fileContext = await buildFileContext(
    params.files ?? [],
    readFileContent
  );
  const stdinContent = fileContext
    ? `${params.prompt}\n\n${fileContext}`
    : params.prompt;

  const tmpDir = await mkdtemp(join(tmpdir(), "codex-out-"));
  const outputFile = join(tmpDir, "response.txt");

  try {
    const bin = process.env.CODEX_BIN ?? "codex";
    let returnedSessionId = "";

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

    if (params.sessionId) {
      const existingCodexId = codexSessions.get(params.sessionId);

      if (existingCodexId) {
        // Resume existing session
        const args = [
          "exec", "resume", existingCodexId, "-",
          "--skip-git-repo-check",
          "-o", outputFile,
          ...imageArgs,
        ];
        await runCli(bin, args, { stdin: stdinContent });
        returnedSessionId = params.sessionId;
      } else {
        // New named session: run without --ephemeral, discover session ID via
        // byte-offset diff of session_index.jsonl
        const args = [
          "exec", "-",
          "--skip-git-repo-check",
          "-o", outputFile,
          ...imageArgs,
        ];
        const codexId = await discoverNewCodexSessionId(bin, args, { stdin: stdinContent });
        storeSession(params.sessionId, codexId);
        returnedSessionId = params.sessionId;
      }
    } else {
      // Stateless (ephemeral) — original behaviour
      const args = [
        "exec", "-",
        "--skip-git-repo-check",
        "--ephemeral",
        "-o", outputFile,
        ...imageArgs,
      ];
      await runCli(bin, args, { stdin: stdinContent });
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
