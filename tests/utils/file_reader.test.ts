import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { readFileContent, readImageAsBase64 } from "../../src/utils/file_reader.js";

// Use a temp dir under homedir so it is within the sandbox root
const testDir = join(homedir(), ".mcp-test-tmp");

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

describe("readImageAsBase64", () => {
  let tmpPng: string;
  let tmpJpg: string;
  let missingPng: string;

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    tmpPng = join(testDir, `test-${Date.now()}.png`);
    tmpJpg = join(testDir, `test-${Date.now()}.jpg`);
    missingPng = join(testDir, `missing-${Date.now()}.png`);
    await writeFile(tmpPng, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(tmpJpg, Buffer.from([0xff, 0xd8, 0xff]));
  });

  afterEach(async () => {
    await unlink(tmpPng).catch(() => {});
    await unlink(tmpJpg).catch(() => {});
  });

  it("returns base64 data and image/png for .png files", async () => {
    const result = await readImageAsBase64(tmpPng);
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
  });

  it("returns image/jpeg for .jpg files", async () => {
    const result = await readImageAsBase64(tmpJpg);
    expect(result.mimeType).toBe("image/jpeg");
  });

  it("throws with the path in the error message when file is missing", async () => {
    await expect(readImageAsBase64(missingPng)).rejects.toThrow(missingPng);
  });

  it("throws for unsupported image types", async () => {
    const tmpTxt = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpTxt, "not an image");
    await expect(readImageAsBase64(tmpTxt)).rejects.toThrow("Unsupported image type");
    await unlink(tmpTxt);
  });

  it("throws for paths outside the workspace root", async () => {
    await expect(readImageAsBase64("/etc/hosts")).rejects.toThrow("access denied");
  });
});
