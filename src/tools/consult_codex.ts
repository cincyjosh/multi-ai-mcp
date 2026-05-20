import { mkdtemp, readFile, rm } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir, homedir } from "os";
import { readFileContent } from "../utils/file_reader.js";
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

    for (const img of params.images ?? []) {
      const expanded = img.startsWith("~/")
        ? join(homedir(), img.slice(2))
        : resolve(img);
      args.push("-i", expanded);
    }

    await runCli("codex", args, { stdin: stdinContent });
    return (await readFile(outputFile, "utf-8")).trim();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
