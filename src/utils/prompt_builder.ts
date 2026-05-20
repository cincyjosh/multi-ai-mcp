const MAX_FILE_BYTES = 100_000;
const MAX_TOTAL_BYTES = 500_000;

export async function buildFileContext(
  files: string[],
  readFile: (path: string) => Promise<string>
): Promise<string> {
  if (files.length === 0) return "";

  let totalBytes = 0;
  const chunks: string[] = [];

  for (const f of files) {
    const content = await readFile(f);
    const bytes = Buffer.byteLength(content, "utf-8");
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`File too large (${bytes} bytes, max ${MAX_FILE_BYTES}): ${f}`);
    }
    totalBytes += bytes;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(`Total file context exceeds limit of ${MAX_TOTAL_BYTES} bytes`);
    }
    chunks.push(`--- ${f} ---\n${content}`);
  }

  return chunks.join("\n\n");
}
