import { readFile, realpath } from "fs/promises";
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

async function resolvePathSafe(filePath: string): Promise<string> {
  const expanded = filePath.startsWith("~/")
    ? resolve(homedir(), filePath.slice(2))
    : resolve(filePath);

  // Use realpath to follow symlinks before the sandbox check
  let real: string;
  try {
    real = await realpath(expanded);
  } catch {
    // File doesn't exist yet — use the normalized path (readFile will fail with ENOENT)
    real = normalize(expanded);
  }

  const root = await realpath(WORKSPACE_ROOT).catch(() => normalize(WORKSPACE_ROOT));

  if (real !== root && !real.startsWith(root + "/")) {
    throw new Error(
      `File access denied (outside workspace ${root}): ${filePath}`
    );
  }
  return real;
}

export function resolveAndValidatePath(filePath: string): string {
  // Synchronous version for use before spawn (images). Does NOT follow symlinks —
  // codex will open the file, so this is a best-effort check. For full symlink safety
  // use the async resolvePathSafe via readFileContent / readImageAsBase64.
  const expanded = filePath.startsWith("~/")
    ? resolve(homedir(), filePath.slice(2))
    : resolve(filePath);
  const normalized = normalize(expanded);
  const root = normalize(WORKSPACE_ROOT);
  if (normalized !== root && !normalized.startsWith(root + "/")) {
    throw new Error(
      `File access denied (outside workspace ${root}): ${filePath}`
    );
  }
  return normalized;
}

export async function readFileContent(filePath: string): Promise<string> {
  const resolved = await resolvePathSafe(filePath);
  try {
    return await readFile(resolved, "utf-8");
  } catch (err: any) {
    throw new Error(`Cannot read file (${err.code ?? "unknown"}): ${filePath}`);
  }
}

export async function readImageAsBase64(
  filePath: string
): Promise<{ data: string; mimeType: string }> {
  const resolved = await resolvePathSafe(filePath);
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
