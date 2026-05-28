import { resolvePathSafe } from "./file_reader.js";
import { dirname } from "path";

export interface FileContext {
  prompt: string;
  directories: string[];
}

export async function buildFileContext(files: string[]): Promise<FileContext> {
  if (files.length === 0) return { prompt: "", directories: [] };

  const resolvedPaths = await Promise.all(files.map((f) => resolvePathSafe(f)));
  const directories = [...new Set(resolvedPaths.map((p) => dirname(p)))];

  const prompt = `The following files are relevant to this request and are accessible in your environment. Use your tools (like read_file or grep) to examine them if needed:\n${resolvedPaths.map((p) => `- ${p}`).join("\n")}`;

  return { prompt, directories };
}
