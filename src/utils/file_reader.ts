import { readFile } from "fs/promises";
import { extname, resolve, normalize } from "path";
import { homedir } from "os";

const WORKSPACE_ROOT = normalize(
  process.env.MCP_WORKSPACE_ROOT ?? homedir()
);

const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function resolvePath(filePath: string): string {
  const expanded = filePath.startsWith("~/")
    ? resolve(homedir(), filePath.slice(2))
    : resolve(filePath);
  const normalized = normalize(expanded);
  if (
    normalized !== WORKSPACE_ROOT &&
    !normalized.startsWith(WORKSPACE_ROOT + "/")
  ) {
    throw new Error(
      `File access denied (outside workspace ${WORKSPACE_ROOT}): ${filePath}`
    );
  }
  return normalized;
}

export async function readFileContent(filePath: string): Promise<string> {
  const resolved = resolvePath(filePath);
  try {
    return await readFile(resolved, "utf-8");
  } catch (err: any) {
    throw new Error(`Cannot read file (${err.code ?? "unknown"}): ${filePath}`);
  }
}

export async function readImageAsBase64(
  filePath: string
): Promise<{ data: string; mimeType: string }> {
  const resolved = resolvePath(filePath);
  const ext = extname(resolved).toLowerCase();
  const mimeType = SUPPORTED_IMAGE_TYPES[ext];
  if (!mimeType) {
    throw new Error(`Unsupported image type "${ext}": ${filePath}`);
  }
  try {
    const buffer = await readFile(resolved);
    return { data: buffer.toString("base64"), mimeType };
  } catch (err: any) {
    throw new Error(
      `Cannot read image (${err.code ?? "unknown"}): ${filePath}`
    );
  }
}
