import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const testDir = join(process.cwd(), ".mcp-test-tmp-gemini");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultGemini } from "../../src/tools/consult_gemini.js";

describe("consultGemini", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    mockRunCli.mockClear();
    mockRunCli.mockResolvedValue("gemini response");
  });

  it("returns stdout as the response", async () => {
    const result = await consultGemini({ prompt: "Hello" });
    expect(result).toBe("gemini response");
  });

  it("calls gemini with -p -, and passes the prompt via stdin", async () => {
    await consultGemini({ prompt: "Hello" });
    const [cmd, args, options] = mockRunCli.mock.calls[0];
    expect(cmd).toBe("gemini");
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toBe("-");
    expect(options.stdin).toBe("Hello");
  });

  it("merges prompt and file contents into stdin", async () => {
    const tmpFile = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "gemini file content");

    await consultGemini({ prompt: "Review this", files: [tmpFile] });
    const options = mockRunCli.mock.calls[0][2];
    expect(options.stdin).toContain("Review this");
    expect(options.stdin).toContain("gemini file content");

    await unlink(tmpFile);
  });

  it("always passes stdin even when no files given", async () => {
    await consultGemini({ prompt: "Hello" });
    const options = mockRunCli.mock.calls[0][2];
    expect(options.stdin).toBe("Hello");
  });

  it("throws when a file does not exist", async () => {
    const missing = join(testDir, "nonexistent.txt");
    await expect(
      consultGemini({ prompt: "test", files: [missing] })
    ).rejects.toThrow();
  });
});
