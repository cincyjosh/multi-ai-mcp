import { resolvePathSafe, O_NOFOLLOW } from "./file_reader.js";
import { dirname } from "path";
import { open, constants } from "fs/promises";

export interface FileContext {
  prompt: string;
  directories: string[];
}

export async function buildFileContext(files: string[]): Promise<FileContext> {
  if (files.length === 0) return { prompt: "", directories: [] };

  const resolvedPaths = await Promise.all(files.map((f) => resolvePathSafe(f)));

  // Verify all files exist and are regular files.
  // O_NOFOLLOW closes the TOCTOU window: if the path is replaced with a symlink
  // between resolvePathSafe's realpath check and this open(), the open fails.
  await Promise.all(
    resolvedPaths.map(async (p, i) => {
      let fd: Awaited<ReturnType<typeof open>>;
      try {
        fd = await open(p, constants.O_RDONLY | O_NOFOLLOW);
      } catch (err: any) {
        if (err.code === "ENOENT") throw new Error(`File not found: ${files[i]}`);
        if (err.code === "ELOOP" || err.code === "ENOTSUP") {
          throw new Error(`File is a symlink: ${files[i]}`);
        }
        throw err;
      }
      try {
        const info = await fd.stat();
        if (!info.isFile()) throw new Error(`Not a regular file: ${files[i]}`);
      } finally {
        await fd.close();
      }
    })
  );

  const directories = [...new Set(resolvedPaths.map((p) => dirname(p)))];

  const prompt = `The following files are relevant to this request and are accessible in your environment. Use your tools (like read_file or grep) to examine them if needed:\n${resolvedPaths
    .map((p) => `- ${p}`)
    .join("\n")}`;

  return { prompt, directories };
}
