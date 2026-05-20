import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const testDir = join(homedir(), ".mcp-test-tmp");

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

  it("calls gemini with -p, the prompt, and -o text flags", async () => {
    await consultGemini({ prompt: "Hello" });
    const [cmd, args] = mockRunCli.mock.calls[0];
    expect(cmd).toBe("gemini");
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toBe("Hello");
    expect(args).toContain("-o");
    expect(args).toContain("text");
  });

  it("passes file contents via stdin", async () => {
    const tmpFile = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "gemini file content");

    await consultGemini({ prompt: "Review this", files: [tmpFile] });
    const options = mockRunCli.mock.calls[0][2];
    expect(options.stdin).toContain("gemini file content");

    await unlink(tmpFile);
  });

  it("passes no stdin option when no files given", async () => {
    await consultGemini({ prompt: "Hello" });
    const options = mockRunCli.mock.calls[0][2];
    expect(options).toEqual({});
  });

  it("throws when a file does not exist", async () => {
    const missing = join(testDir, "nonexistent.txt");
    await expect(
      consultGemini({ prompt: "test", files: [missing] })
    ).rejects.toThrow();
  });
});
