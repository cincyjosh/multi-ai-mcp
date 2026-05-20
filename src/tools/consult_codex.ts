import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFileContent, resolvePathSafe } from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";
import { buildFileContext } from "../utils/prompt_builder.js";

export async function consultCodex(params: {
  prompt: string;
  files?: string[];
  images?: string[];
}): Promise<string> {
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
    const args = [
      "exec",
      "-",
      "--skip-git-repo-check",
      "--ephemeral",
      "-o",
      outputFile,
    ];

    if (params.images) {
      for (const img of params.images) {
        const validated = await resolvePathSafe(img);
        args.push("-i", validated);
      }
    }

    await runCli("codex", args, { stdin: stdinContent });
    return (await readFile(outputFile, "utf-8")).trim();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
