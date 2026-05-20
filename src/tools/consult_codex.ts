import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFileContent } from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";

export async function consultCodex(params: {
  prompt: string;
  files?: string[];
  images?: string[];
}): Promise<string> {
  let prompt = params.prompt;

  if (params.files && params.files.length > 0) {
    const chunks = await Promise.all(
      params.files.map(async (f) => `--- ${f} ---\n${await readFileContent(f)}`)
    );
    prompt += "\n\n" + chunks.join("\n\n");
  }

  const tmpDir = await mkdtemp(join(tmpdir(), "codex-out-"));
  const outputFile = join(tmpDir, "response.txt");

  try {
    const args = [
      "exec",
      prompt,
      "--skip-git-repo-check",
      "--ephemeral",
      "-o",
      outputFile,
    ];

    if (params.images) {
      for (const img of params.images) {
        args.push("-i", img);
      }
    }

    await runCli("codex", args);
    return (await readFile(outputFile, "utf-8")).trim();
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
