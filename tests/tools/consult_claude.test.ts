import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join } from "path";

const testDir = join(process.cwd(), ".mcp-test-tmp-claude");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultClaude } from "../../src/tools/consult_claude.js";

describe("consultClaude", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    mockRunCli.mockClear();
    mockRunCli.mockResolvedValue({ stdout: "claude response", stderr: "" });
  });

  it("returns stdout as the response", async () => {
    const result = await consultClaude({ prompt: "Hello" });
    expect(result.response).toBe("claude response");
  });

  it("returns empty sessionId when no session requested", async () => {
    const result = await consultClaude({ prompt: "Hello" });
    expect(result.sessionId).toBe("");
  });

  it("calls claude in print mode and passes the prompt via stdin", async () => {
    await consultClaude({ prompt: "Hello" });
    const [cmd, args, options] = mockRunCli.mock.calls[0];
    expect(cmd).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args[args.indexOf("--output-format") + 1]).toBe("text");
    expect(options.stdin).toBe("Hello");
  });

  it("uses no session persistence for stateless calls", async () => {
    await consultClaude({ prompt: "Hello" });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).toContain("--no-session-persistence");
    expect(args).not.toContain("--session-id");
  });

  it("uses --session-id when a session is active", async () => {
    const sessionId = "77777777-7777-7777-7777-777777777777";
    const result = await consultClaude({ prompt: "Hello", sessionId });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).toContain("--session-id");
    expect(args[args.indexOf("--session-id") + 1]).toBe(sessionId);
    expect(args).not.toContain("--no-session-persistence");
    expect(result.sessionId).toBe(sessionId);
  });

  it("merges prompt and file contents into stdin", async () => {
    const tmpFile = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "claude file content");

    await consultClaude({ prompt: "Review this", files: [tmpFile] });
    const options = mockRunCli.mock.calls[0][2];
    expect(options.stdin).toContain("Review this");
    expect(options.stdin).toContain("claude file content");

    await unlink(tmpFile);
  });

  it("throws when a file does not exist", async () => {
    const missing = join(testDir, "nonexistent.txt");
    await expect(
      consultClaude({ prompt: "test", files: [missing] })
    ).rejects.toThrow();
  });

  it("passes --add-dir when directory is provided", async () => {
    await consultClaude({ prompt: "Review this repo", directory: testDir });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const idx = args.indexOf("--add-dir");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(testDir);
  });

  it("adds image paths to stdin using private temp copies", async () => {
    const tmpImg = join(testDir, `test-${Date.now()}.png`);
    await writeFile(tmpImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await consultClaude({ prompt: "Describe this", images: [tmpImg] });
    const args: string[] = mockRunCli.mock.calls[0][1];
    const options = mockRunCli.mock.calls[0][2];

    expect(args).toContain("--add-dir");
    expect(options.stdin).toContain("Attached images:");
    expect(options.stdin).toContain("image-0.png");
    expect(options.stdin).not.toContain(tmpImg);

    await unlink(tmpImg);
  });

  it("throws when an image has an unsupported file type", async () => {
    const tmpTxt = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpTxt, "not an image");
    await expect(
      consultClaude({ prompt: "Describe this", images: [tmpTxt] })
    ).rejects.toThrow("Unsupported image type");
    await unlink(tmpTxt);
  });
});
