import { readFileContent } from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";
import { buildFileContext } from "../utils/prompt_builder.js";

export async function consultGemini(params: {
  prompt: string;
  files?: string[];
}): Promise<string> {
  const fileContext = await buildFileContext(
    params.files ?? [],
    readFileContent
  );

  const result = await runCli(
    "gemini",
    ["-p", params.prompt, "-o", "text"],
    fileContext ? { stdin: fileContext } : {}
  );
  return result.trim();
}
