import { readFileContent } from "../utils/file_reader.js";
import { runCli } from "../utils/run_cli.js";

export async function consultGemini(params: {
  prompt: string;
  files?: string[];
}): Promise<string> {
  let prompt = params.prompt;

  if (params.files && params.files.length > 0) {
    const chunks = await Promise.all(
      params.files.map(async (f) => `--- ${f} ---\n${await readFileContent(f)}`)
    );
    prompt += "\n\n" + chunks.join("\n\n");
  }

  const result = await runCli("gemini", ["-p", prompt, "-o", "text"]);
  return result.trim();
}
