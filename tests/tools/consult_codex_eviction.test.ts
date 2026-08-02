import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

const testDir = join(process.cwd(), ".mcp-test-tmp-codex");

const { mockRunCli } = vi.hoisted(() => ({ mockRunCli: vi.fn() }));
vi.mock("../../src/utils/run_cli.js", () => ({ runCli: mockRunCli }));

import { consultCodex } from "../../src/tools/consult_codex.js";

// Fresh module instance per file — codexSessions Map starts empty here.
describe("consultCodex session cache eviction", () => {
  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
    mockRunCli.mockClear();
    let newSessionCallCount = 0;
    mockRunCli.mockImplementation(async (_cmd: string, _args: string[]) => {
      const args = _args as string[];
      const oIndex = args.indexOf("-o");
      if (oIndex !== -1) {
        await writeFile(args[oIndex + 1], "codex response");
      }
      let stderr = "";
      // Only emit a session ID for non-ephemeral, non-resume calls
      if (!args.includes("--ephemeral") && !args.includes("resume")) {
        newSessionCallCount++;
        stderr = `session review: aaaaaaaa-bbbb-cccc-dddd-${String(newSessionCallCount).padStart(12, "0")}`;
      }
      return { stdout: "", stderr };
    });
  });

  it(
    "evicts the oldest session when the cache exceeds MAX_SESSIONS",
    { timeout: 30_000 },
    async () => {
      // session0 is inserted first — it is the eviction candidate
      const session0 = "00000000-0000-4000-8000-000000000000";
      await consultCodex({ prompt: "first", sessionId: session0 });

      // Fill the remaining 999 slots to reach MAX_SESSIONS (1000)
      for (let i = 1; i < 1000; i++) {
        const id = `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
        await consultCodex({ prompt: "fill", sessionId: id });
      }

      // One more session pushes the cache over MAX_SESSIONS, evicting session0
      await consultCodex({
        prompt: "overflow",
        sessionId: "ffffffff-0000-4000-8000-000000000000",
      });

      mockRunCli.mockClear();

      // session0 should have been evicted — the next call must start a new
      // session (exec without "resume"), not resume the old one
      await consultCodex({ prompt: "after eviction", sessionId: session0 });
      const args = mockRunCli.mock.calls[0][1] as string[];
      expect(args).not.toContain("resume");
    }
  );
});
