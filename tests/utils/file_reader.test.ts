import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFileContent, readImageAsBase64 } from "../../src/utils/file_reader.js";

describe("readFileContent", () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = join(tmpdir(), `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "hello world");
  });

  afterEach(async () => {
    await unlink(tmpFile).catch(() => {});
  });

  it("reads a file and returns its content", async () => {
    expect(await readFileContent(tmpFile)).toBe("hello world");
  });

  it("throws with the path in the error message when file is missing", async () => {
    await expect(readFileContent("/nonexistent/path.txt")).rejects.toThrow(
      "/nonexistent/path.txt"
    );
  });
});

describe("readImageAsBase64", () => {
  let tmpPng: string;
  let tmpJpg: string;

  beforeEach(async () => {
    tmpPng = join(tmpdir(), `test-${Date.now()}.png`);
    tmpJpg = join(tmpdir(), `test-${Date.now()}.jpg`);
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
    await expect(readImageAsBase64("/nonexistent/image.png")).rejects.toThrow(
      "/nonexistent/image.png"
    );
  });
});
