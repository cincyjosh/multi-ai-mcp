import { describe, it, expect } from "vitest";
import { buildFileContext } from "../../src/utils/prompt_builder.js";

const fakeRead = async (path: string) => `content of ${path}`;

describe("buildFileContext", () => {
  it("returns empty string when no files given", async () => {
    expect(await buildFileContext([], fakeRead)).toBe("");
  });

  it("formats file contents with path headers", async () => {
    const result = await buildFileContext(["/a.ts", "/b.ts"], fakeRead);
    expect(result).toContain("--- /a.ts ---");
    expect(result).toContain("content of /a.ts");
    expect(result).toContain("--- /b.ts ---");
  });

  it("throws when a single file exceeds MAX_FILE_BYTES", async () => {
    const bigRead = async (_: string) => "x".repeat(100_001);
    await expect(buildFileContext(["/big.ts"], bigRead)).rejects.toThrow(
      "File too large"
    );
  });

  it("throws when total file context exceeds MAX_TOTAL_BYTES", async () => {
    const chunkRead = async (_: string) => "x".repeat(90_000);
    const files = ["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts", "/f.ts"];
    await expect(buildFileContext(files, chunkRead)).rejects.toThrow(
      "Total file context exceeds limit"
    );
  });
});
