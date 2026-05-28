import { resolvePathSafe } from "./file_reader.js";
import { dirname } from "path";
import { stat } from "fs/promises";

export interface FileContext {
  prompt: string;
  directories: string[];
}

export async function buildFileContext(files: string[]): Promise<FileContext> {
  if (files.length === 0) return { prompt: "", directories: [] };

  const resolvedPaths = await Promise.all(files.map((f) => resolvePathSafe(f)));

  // Verify all files exist
  await Promise.all(
    resolvedPaths.map(async (p, i) => {
      try {
        const info = await stat(p);
        if (!info.isFile()) {
          throw new Error(`Not a regular file: ${files[i]}`);
        }
      } catch (err: any) {
        if (err.code === "ENOENT") {
          throw new Error(`File not found: ${files[i]}`);
        }
        throw err;
      }
    })
  );

  const directories = [...new Set(resolvedPaths.map((p) => dirname(p)))];

  const prompt = `The following files are relevant to this request and are accessible in your environment. Use your tools (like read_file or grep) to examine them if needed:\n${resolvedPaths
    .map((p) => `- ${p}`)
    .join("\n")}`;

  return { prompt, directories };
}
