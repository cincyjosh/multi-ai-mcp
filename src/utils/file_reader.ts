import { readFile } from "fs/promises";
import { extname, resolve } from "path";
import { homedir } from "os";

function resolvePath(filePath: string): string {
  return filePath.startsWith("~/")
    ? resolve(homedir(), filePath.slice(2))
    : resolve(filePath);
}

export async function readFileContent(filePath: string): Promise<string> {
  try {
    return await readFile(resolvePath(filePath), "utf-8");
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }
}

export async function readImageAsBase64(
  filePath: string
): Promise<{ data: string; mimeType: string }> {
  try {
    const buffer = await readFile(resolvePath(filePath));
    const mimeType =
      extname(filePath).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    return { data: buffer.toString("base64"), mimeType };
  } catch {
    throw new Error(`Cannot read image: ${filePath}`);
  }
}
