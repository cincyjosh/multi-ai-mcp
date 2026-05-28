import { vi, describe, it, expect } from "vitest";
import { resolvePathSafe } from "../../src/utils/file_reader.js";
import { stat } from "fs/promises";

vi.mock("../../src/utils/file_reader.js", () => ({
  resolvePathSafe: vi.fn(async (path: string) => path),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    stat: vi.fn(async (path: string) => ({
      isFile: () => true,
    })),
  };
});

import { buildFileContext } from "../../src/utils/prompt_builder.js";

const mockResolve = vi.mocked(resolvePathSafe);

describe("buildFileContext", () => {
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
});
