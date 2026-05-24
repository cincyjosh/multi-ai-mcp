import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";

const testDir = join(process.cwd(), ".mcp-test-tmp-gemini");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultGemini } from "../../src/tools/consult_gemini.js";

describe("consultGemini", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    mockRunCli.mockClear();
    mockRunCli.mockResolvedValue({ stdout: "gemini response", stderr: "" });
  });

  it("returns stdout as the response", async () => {
    const result = await consultGemini({ prompt: "Hello" });
    expect(result.response).toBe("gemini response");
  });

  it("returns empty sessionId when no session requested", async () => {
    const result = await consultGemini({ prompt: "Hello" });
    expect(result.sessionId).toBe("");
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

  it("uses --session-id on the first call for a new session", async () => {
    const sessionId = "44444444-4444-4444-4444-444444444444";
    await consultGemini({ prompt: "Hello", sessionId });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).toContain("--session-id");
    expect(args).not.toContain("--resume");
    expect(args[args.indexOf("--session-id") + 1]).toBe(sessionId);
  });

  it("uses --resume on subsequent calls for the same session", async () => {
    const sessionId = "55555555-5555-5555-5555-555555555555";
    await consultGemini({ prompt: "First", sessionId });
    await consultGemini({ prompt: "Second", sessionId });
    const args: string[] = mockRunCli.mock.calls[1][1];
    expect(args).toContain("--resume");
    expect(args).not.toContain("--session-id");
    expect(args[args.indexOf("--resume") + 1]).toBe(sessionId);
  });

  it("returns the sessionId when a session is active", async () => {
    const sessionId = "66666666-6666-6666-6666-666666666666";
    const result = await consultGemini({ prompt: "Hello", sessionId });
    expect(result.sessionId).toBe(sessionId);
  });

  it("passes --include-directories when directory is provided", async () => {
    await consultGemini({ prompt: "Review this repo", directory: testDir });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const idx = args.indexOf("--include-directories");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(testDir);
  });

  it("does not pass --session-id or --resume when sessionId is omitted", async () => {
    await consultGemini({ prompt: "Hello" });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--resume");
  });
});
