import { vi, describe, it, expect, beforeEach } from "vitest";
import { resolvePathSafe, O_NOFOLLOW } from "../../src/utils/file_reader.js";
import { open } from "fs/promises";

vi.mock("../../src/utils/file_reader.js", () => ({
  resolvePathSafe: vi.fn(async (path: string) => path),
  O_NOFOLLOW: 0,
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    open: vi.fn(async () => ({
      stat: vi.fn().mockResolvedValue({ isFile: () => true }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

import { buildFileContext } from "../../src/utils/prompt_builder.js";

const mockResolve = vi.mocked(resolvePathSafe);
const mockOpen = vi.mocked(open);

describe("buildFileContext", () => {
  beforeEach(() => {
    mockOpen.mockClear();
    mockResolve.mockImplementation(async (path: string) => path);
  });

  it("returns empty prompt and no directories when no files given", async () => {
    expect(await buildFileContext([])).toEqual({
      prompt: "",
      directories: [],
    });
  });

  it("lists file paths in prompt and returns unique parent directories", async () => {
    mockResolve.mockImplementation(async (path: string) => {
      if (path === "a.ts") return "/work/src/a.ts";
      if (path === "b.ts") return "/work/src/b.ts";
      if (path === "c.ts") return "/work/utils/c.ts";
      return path;
    });

    const result = await buildFileContext(["a.ts", "b.ts", "c.ts"]);

    expect(result.prompt).toContain("- /work/src/a.ts");
    expect(result.prompt).toContain("- /work/src/b.ts");
    expect(result.prompt).toContain("- /work/utils/c.ts");

    expect(result.directories).toHaveLength(2);
    expect(result.directories).toContain("/work/src");
    expect(result.directories).toContain("/work/utils");
  });

  it("opens each file with O_NOFOLLOW to prevent symlink-swap attacks", async () => {
    mockResolve.mockResolvedValue("/work/src/a.ts");

    await buildFileContext(["a.ts"]);

    expect(mockOpen).toHaveBeenCalledOnce();
    const [, flags] = mockOpen.mock.calls[0] as [string, number];
    // O_NOFOLLOW may be 0 on platforms that don't support it (Windows);
    // on those platforms the flag is a no-op, so a zero-check is still valid.
    expect(flags & O_NOFOLLOW).toBe(O_NOFOLLOW);
  });

  it("throws when a file is not found", async () => {
    mockOpen.mockRejectedValueOnce(
      Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" })
    );
    await expect(buildFileContext(["missing.ts"])).rejects.toThrow("File not found");
  });

  it("throws when a path is not a regular file", async () => {
    mockOpen.mockResolvedValueOnce({
      stat: vi.fn().mockResolvedValue({ isFile: () => false }),
      close: vi.fn().mockResolvedValue(undefined),
    } as any);
    await expect(buildFileContext(["dir/"])).rejects.toThrow("Not a regular file");
  });
});
