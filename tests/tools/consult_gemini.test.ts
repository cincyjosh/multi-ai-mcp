import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultGemini } from "../../src/tools/consult_gemini.js";

describe("consultGemini", () => {
  beforeEach(() => {
    mockRunCli.mockClear();
    mockRunCli.mockResolvedValue("gemini response");
  });

  it("returns stdout as the response", async () => {
    const result = await consultGemini({ prompt: "Hello" });
    expect(result).toBe("gemini response");
  });

  it("calls gemini with -p and -o text flags", async () => {
    await consultGemini({ prompt: "Hello" });
    const [cmd, args] = mockRunCli.mock.calls[0];
    expect(cmd).toBe("gemini");
    expect(args).toContain("-p");
    expect(args).toContain("-o");
    expect(args).toContain("text");
  });

  it("appends file contents to the prompt", async () => {
    const tmpFile = join(tmpdir(), `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "gemini file content");

    await consultGemini({ prompt: "Review this", files: [tmpFile] });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const promptArg = args[args.indexOf("-p") + 1];
    expect(promptArg).toContain("gemini file content");

    await unlink(tmpFile);
  });

  it("throws when a file does not exist", async () => {
    await expect(
      consultGemini({ prompt: "test", files: ["/nonexistent.txt"] })
    ).rejects.toThrow("/nonexistent.txt");
  });
});
