import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, unlink, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

const testDir = join(process.cwd(), ".mcp-test-tmp-codex");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultCodex } from "../../src/tools/consult_codex.js";

describe("consultCodex", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    mockRunCli.mockClear();
    mockRunCli.mockImplementation(async (_cmd: string, _args: string[]) => {
      const args = _args as string[];
      const oIndex = args.indexOf("-o");
      if (oIndex !== -1) {
        await writeFile(args[oIndex + 1], "codex response");
      }
      return "";
    });
  });

  it("returns the content of the output file", async () => {
    const result = await consultCodex({ prompt: "Hello" });
    expect(result).toBe("codex response");
  });

  it("calls codex with --skip-git-repo-check and --ephemeral", async () => {
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

  it("adds -i flags for each image with expanded paths", async () => {
    const tmpImg = join(testDir, `test-${Date.now()}.png`);
    await writeFile(tmpImg, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await consultCodex({ prompt: "Describe this", images: [tmpImg] });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).toContain("-i");
    expect(args).toContain(tmpImg);

    await unlink(tmpImg);
  });

  it("throws when a file does not exist", async () => {
    const missing = join(testDir, "nonexistent.txt");
    await expect(
      consultCodex({ prompt: "test", files: [missing] })
    ).rejects.toThrow();
  });
});
