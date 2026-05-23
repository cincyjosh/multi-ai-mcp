import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/utils/file_reader.js", () => ({
  readFileContent: vi.fn(async (path: string) => `content of ${path}`),
  MAX_FILE_BYTES: 100_000,
}));

import { readFileContent } from "../../src/utils/file_reader.js";
import { buildFileContext } from "../../src/utils/prompt_builder.js";

const mockRead = vi.mocked(readFileContent);

describe("buildFileContext", () => {
  beforeEach(() => {
    mockRead.mockImplementation(async (path: string) => `content of ${path}`);
  });

  it("returns empty string when no files given", async () => {
    expect(await buildFileContext([])).toBe("");
  });

  it("formats file contents with path headers", async () => {
    const result = await buildFileContext(["/a.ts", "/b.ts"]);
    expect(result).toContain('<file path="/a.ts">');
    expect(result).toContain("content of /a.ts");
    expect(result).toContain('<file path="/b.ts">');
  });

  it("throws when a single file exceeds MAX_FILE_BYTES", async () => {
    mockRead.mockResolvedValueOnce("x".repeat(100_001));
    await expect(buildFileContext(["/big.ts"])).rejects.toThrow("File too large");
  });

  it("throws when total file context exceeds MAX_TOTAL_BYTES", async () => {
    mockRead.mockResolvedValue("x".repeat(90_000));
    const files = ["/a.ts", "/b.ts", "/c.ts", "/d.ts", "/e.ts", "/f.ts"];
    await expect(buildFileContext(files)).rejects.toThrow(
      "Total file context exceeds limit"
    );
  });
});
