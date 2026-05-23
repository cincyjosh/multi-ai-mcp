import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, unlink, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const testDir = join(process.cwd(), ".mcp-test-tmp-codex");

// Override CODEX_HOME so session_index.jsonl is written to our test dir
process.env.CODEX_HOME = testDir;
const sessionIndexPath = join(testDir, "session_index.jsonl");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultCodex } from "../../src/tools/consult_codex.js";

describe("consultCodex", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    // Clear session_index.jsonl before each test
    try { await unlink(sessionIndexPath); } catch {}
    mockRunCli.mockClear();
    mockRunCli.mockImplementation(async (_cmd: string, _args: string[]) => {
      const args = _args as string[];
      const oIndex = args.indexOf("-o");
      if (oIndex !== -1) {
        await writeFile(args[oIndex + 1], "codex response");
      }
      // Simulate Codex writing a session entry (for non-ephemeral runs)
      if (!args.includes("--ephemeral")) {
        const entry = { id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", thread_name: "test", updated_at: new Date().toISOString() };
        await writeFile(sessionIndexPath, JSON.stringify(entry) + "\n", { flag: "a" });
      }
      return "";
    });
  });

  it("returns the content of the output file", async () => {
    const result = await consultCodex({ prompt: "Hello" });
    expect(result.response).toBe("codex response");
  });

  it("returns empty sessionId for stateless calls", async () => {
    const result = await consultCodex({ prompt: "Hello" });
    expect(result.sessionId).toBe("");
  });

  it("calls codex with --skip-git-repo-check and --ephemeral when no sessionId", async () => {
    await consultCodex({ prompt: "Hello" });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--ephemeral");
  });

  it("passes prompt via stdin not as a positional arg", async () => {
    await consultCodex({ prompt: "my question" });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const options = mockRunCli.mock.calls[0][2];
    expect(args[1]).toBe("-");
    expect(options.stdin).toContain("my question");
  });

  it("includes file contents in stdin", async () => {
    const tmpFile = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "file content here");

    await consultCodex({ prompt: "Review this", files: [tmpFile] });
    const options = mockRunCli.mock.calls[0][2];
    expect(options.stdin).toContain("file content here");

    await unlink(tmpFile);
  });

  it("adds -i flags for each image using a private temp copy", async () => {
    const tmpImg = join(testDir, `test-${Date.now()}.png`);
    await writeFile(tmpImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await consultCodex({ prompt: "Describe this", images: [tmpImg] });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const iIndex = args.indexOf("-i");
    expect(iIndex).toBeGreaterThan(-1);
    // The path passed to codex is a private temp copy, not the original path
    expect(args[iIndex + 1]).toMatch(/image-0\.png$/);
    expect(args[iIndex + 1]).not.toBe(tmpImg);

    await unlink(tmpImg);
  });

  it("throws when an image has an unsupported file type", async () => {
    const tmpTxt = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpTxt, "not an image");
    await expect(
      consultCodex({ prompt: "Describe this", images: [tmpTxt] })
    ).rejects.toThrow("Unsupported image type");
    await unlink(tmpTxt);
  });

  it("throws when a file does not exist", async () => {
    const missing = join(testDir, "nonexistent.txt");
    await expect(
      consultCodex({ prompt: "test", files: [missing] })
    ).rejects.toThrow();
  });

  it("uses no --ephemeral for a new named session", async () => {
    const sessionId = "11111111-1111-1111-1111-111111111111";
    await consultCodex({ prompt: "Hello", sessionId });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).not.toContain("--ephemeral");
  });

  it("returns the caller sessionId for named sessions", async () => {
    const sessionId = "22222222-2222-2222-2222-222222222222";
    const result = await consultCodex({ prompt: "Hello", sessionId });
    expect(result.sessionId).toBe(sessionId);
  });

  it("passes -C when directory is provided", async () => {
    await consultCodex({ prompt: "Review this repo", directory: testDir });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const cIndex = args.indexOf("-C");
    expect(cIndex).toBeGreaterThan(-1);
    expect(args[cIndex + 1]).toBe(testDir);
  });

  it("uses exec resume on a subsequent call with the same sessionId", async () => {
    const sessionId = "33333333-3333-3333-3333-333333333333";
    // First call: establish the session
    await consultCodex({ prompt: "First", sessionId });
    // Second call: should resume using the Codex internal ID
    await consultCodex({ prompt: "Second", sessionId });
    const resumeArgs: string[] = mockRunCli.mock.calls[1][1];
    expect(resumeArgs[1]).toBe("resume");
    // Should use the Codex internal ID (from session_index), not the caller's UUID
    expect(resumeArgs[2]).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });
});
