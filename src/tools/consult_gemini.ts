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

  const stdinContent = fileContext
    ? `${params.prompt}\n\n${fileContext}`
    : params.prompt;

  const result = await runCli(
    "gemini",
    ["-p", "-", "-o", "text"],
    { stdin: stdinContent }
  );
  return result.trim();
}
