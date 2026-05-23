import { readFileContent, MAX_FILE_BYTES } from "./file_reader.js";

const MAX_TOTAL_BYTES = 500_000;

export async function buildFileContext(files: string[]): Promise<string> {
  if (files.length === 0) return "";

  const contents = await Promise.all(files.map((f) => readFileContent(f)));

  let totalBytes = 0;
  const chunks: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const content = contents[i];
    const contentBytes = Buffer.byteLength(content, "utf-8");
    if (contentBytes > MAX_FILE_BYTES) {
      throw new Error(
        `File too large (${contentBytes} bytes, max ${MAX_FILE_BYTES}): ${files[i]}`
      );
    }
    // Use a distinctive tag-style delimiter that is very unlikely to appear
    // organically in file content, making section-spoofing harder.
    // Newlines and XML attribute-special characters are escaped so a crafted
    // filename can't break out of the path="" attribute or inject new tags.
    const safeName = files[i]
      .replace(/[\r\n]/g, " ")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const chunk = `<file path="${safeName}">\n${content}\n</file>`;
    totalBytes += Buffer.byteLength(chunk, "utf-8");
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `Total file context exceeds limit of ${MAX_TOTAL_BYTES} bytes`
      );
    }
    chunks.push(chunk);
  }

  return chunks.join("\n\n");
}
