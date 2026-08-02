import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile, unlink } from "fs/promises";
import { join, dirname } from "path";

const testDir = join(process.cwd(), ".mcp-test-tmp-antigravity");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultAntigravity, consultGemini } from "../../src/tools/consult_antigravity.js";

describe("consultAntigravity & consultGemini", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    mockRunCli.mockClear();
    mockRunCli.mockResolvedValue({ stdout: "agy response", stderr: "" });
  });

  it("calls agy with the prompt passed to the -p flag", async () => {
    const result = await consultAntigravity({ prompt: "Hello" });
    expect(result.response).toBe("agy response");
  });

  it("calls agy with -p <prompt>", async () => {
    await consultAntigravity({ prompt: "Hello" });
    const [cmd, args] = mockRunCli.mock.calls[0];
    expect(cmd).toBe("agy");
    expect(args).toContain("-p");
    expect(args[args.indexOf("-p") + 1]).toBe("Hello");
    expect(args).toContain("--dangerously-skip-permissions");
  });

  it("points to files and adds their directories via --add-dir", async () => {
    const tmpFile = join(testDir, `test-${Date.now()}.txt`);
    await writeFile(tmpFile, "agy file content");

    await consultAntigravity({ prompt: "Review this", files: [tmpFile] });
    const args = mockRunCli.mock.calls[0][1];

    expect(args[args.indexOf("-p") + 1]).toContain("Review this");
    expect(args[args.indexOf("-p") + 1]).toContain(tmpFile);
    expect(args).toContain("--add-dir");
    expect(args).toContain(dirname(tmpFile));

    await unlink(tmpFile);
  });

  it("uses --conversation when sessionId is provided", async () => {
    const sessionId = "44444444-4444-4444-4444-444444444444";
    await consultAntigravity({ prompt: "Hello", sessionId });
    const args: string[] = mockRunCli.mock.calls[0][1];
    expect(args).toContain("--conversation");
    expect(args[args.indexOf("--conversation") + 1]).toBe(sessionId);
  });

  it("calls consultGemini and triggers console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await consultGemini({ prompt: "Hello" });
    expect(result.response).toBe("agy response");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("consult_gemini is deprecated")
    );
    warnSpy.mockRestore();
  });
});
