import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { readFileContent, resolveDirectorySafe, resolveImagePathSafe } from "../../src/utils/file_reader.js";

const testDir = join(process.cwd(), ".mcp-test-tmp-reader");

describe("readFileContent", () => {
  let tmpFile: string;
  let missingFile: string;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    tmpFile = join(testDir, `test-${Date.now()}.txt`);
    missingFile = join(testDir, `missing-${Date.now()}.txt`);
    await writeFile(tmpFile, "hello world");
  });

  afterEach(async () => {
    await unlink(tmpFile).catch(() => {});
  });

  it("reads a file and returns its content", async () => {
    expect(await readFileContent(tmpFile)).toBe("hello world");
  });

  it("throws with the path in the error message when file is missing", async () => {
    await expect(readFileContent(missingFile)).rejects.toThrow(missingFile);
  });

  it("throws for paths outside the workspace root", async () => {
    await expect(readFileContent("/etc/hosts")).rejects.toThrow("access denied");
  });
});

describe("resolveImagePathSafe", () => {
  let tmpPng: string;
  let tmpTxt: string;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    tmpPng = join(testDir, `test-${Date.now()}.png`);
    tmpTxt = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(tmpTxt, "not an image");
  });

  afterEach(async () => {
    await unlink(tmpPng).catch(() => {});
    await unlink(tmpTxt).catch(() => {});
  });

  it("returns the resolved path for a supported image type", async () => {
    const result = await resolveImagePathSafe(tmpPng);
    expect(result).toBe(tmpPng);
  });

  it("throws for unsupported image types", async () => {
    await expect(resolveImagePathSafe(tmpTxt)).rejects.toThrow(
      "Unsupported image type"
    );
  });

  it("throws for paths outside the workspace root", async () => {
    await expect(resolveImagePathSafe("/etc/hosts")).rejects.toThrow(
      "access denied"
    );
  });
});

describe("resolveDirectorySafe", () => {
  it("resolves a valid directory within the workspace", async () => {
    await mkdir(testDir, { recursive: true });
    const result = await resolveDirectorySafe(testDir);
    expect(result).toBe(testDir);
  });

  it("throws for paths outside the workspace root", async () => {
    await expect(resolveDirectorySafe("/etc")).rejects.toThrow("access denied");
  });

  it("throws when the path is a file, not a directory", async () => {
    await mkdir(testDir, { recursive: true });
    const tmpFile = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "hello");
    try {
      await expect(resolveDirectorySafe(tmpFile)).rejects.toThrow("Not a directory");
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  });

  it("throws for a non-existent path", async () => {
    const missing = join(testDir, "no-such-dir");
    await expect(resolveDirectorySafe(missing)).rejects.toThrow();
  });
});

describe("symlink traversal protection", () => {
  it("rejects a symlink inside workspace pointing outside", async () => {
    await mkdir(testDir, { recursive: true });
    const linkPath = join(testDir, `symlink-${Date.now()}`);
    await symlink("/etc/hosts", linkPath);
    try {
      await expect(readFileContent(linkPath)).rejects.toThrow("access denied");
    } finally {
      await unlink(linkPath).catch(() => {});
    }
  });
});
