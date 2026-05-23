import { open, realpath, stat, constants } from "fs/promises";
import { extname, resolve, normalize, relative, isAbsolute, sep } from "path";
import { homedir } from "os";

const WORKSPACE_ROOT = resolve(
  process.env.MCP_WORKSPACE_ROOT ?? process.cwd()
);

export const MAX_FILE_BYTES = 100_000;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB

// O_NOFOLLOW prevents following a symlink swapped in after path validation (TOCTOU).
// The flag is a no-op on platforms that don't support it (e.g. Windows).
export const O_NOFOLLOW: number = (constants as any).O_NOFOLLOW ?? 0;

const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// Resolved once — workspace root is fixed for the lifetime of the process
const resolvedRoot: Promise<string> = realpath(WORKSPACE_ROOT).catch(() =>
  normalize(WORKSPACE_ROOT)
);

function isOutsideWorkspace(rel: string): boolean {
  // rel.startsWith("..") would incorrectly reject files named "..env.sample".
  // Only treat as traversal if ".." is a full path component.
  return rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel);
}

export async function resolvePathSafe(filePath: string): Promise<string> {
  const home = homedir();
  const expanded =
    filePath === "~" || filePath.startsWith("~/")
      ? resolve(home, filePath.slice(1).replace(/^\//, ""))
      : resolve(WORKSPACE_ROOT, filePath);

  const root = await resolvedRoot;

  // Pre-check against the un-realpath'd workspace root so that a symlinked
  // WORKSPACE_ROOT doesn't cause valid child paths to be incorrectly rejected.
  // This prevents side-channel probing of external paths (ENOENT vs "access denied").
  const preRel = relative(WORKSPACE_ROOT, normalize(expanded));
  if (isOutsideWorkspace(preRel)) {
    throw new Error(`File access denied: ${filePath}`);
  }

  let real: string;
  try {
    real = await realpath(expanded);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
    // File doesn't exist — validate the normalized path; readFile will fail with ENOENT
    real = normalize(expanded);
  }

  const rel = relative(root, real);
  if (isOutsideWorkspace(rel)) {
    throw new Error(`File access denied: ${filePath}`);
  }
  return real;
}

export async function resolveImagePathSafe(filePath: string): Promise<string> {
  const resolved = await resolvePathSafe(filePath);
  const ext = extname(resolved).toLowerCase();
  if (!SUPPORTED_IMAGE_TYPES[ext]) {
    throw new Error(`Unsupported image type "${ext}": ${filePath}`);
  }
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(resolved);
  } catch (err: any) {
    throw new Error(`Cannot access image (${err.code ?? "unknown"}): ${filePath}`);
  }
  if (!info.isFile()) {
    throw new Error(`Not a regular file: ${filePath}`);
  }
  if (info.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${info.size} bytes, max ${MAX_IMAGE_BYTES}): ${filePath}`
    );
  }
  return resolved;
}

export async function resolveDirectorySafe(dirPath: string): Promise<string> {
  const resolved = await resolvePathSafe(dirPath);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(resolved);
  } catch (err: any) {
    throw new Error(`Cannot access directory (${err.code ?? "unknown"}): ${dirPath}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`Not a directory: ${dirPath}`);
  }
  return resolved;
}

export async function readFileContent(filePath: string): Promise<string> {
  const resolved = await resolvePathSafe(filePath);
  let fd: Awaited<ReturnType<typeof open>>;
  try {
    fd = await open(resolved, constants.O_RDONLY | O_NOFOLLOW);
  } catch (err: any) {
    throw new Error(`Cannot read file (${err.code ?? "unknown"}): ${filePath}`);
  }
  try {
    const info = await fd.stat();
    if (!info.isFile()) {
      throw new Error(`Not a regular file: ${filePath}`);
    }
    if (info.size > MAX_FILE_BYTES) {
      throw new Error(
        `File too large (${info.size} bytes, max ${MAX_FILE_BYTES}): ${filePath}`
      );
    }
    return await fd.readFile("utf-8");
  } finally {
    await fd.close();
  }
}
