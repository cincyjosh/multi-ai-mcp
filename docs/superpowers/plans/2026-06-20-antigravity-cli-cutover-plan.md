# Antigravity CLI (agy) Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the codebase to replace legacy `gemini` CLI subprocess logic with `antigravity` (`agy`) CLI logic, expose a new `consult_antigravity` tool, and keep `consult_gemini` as a deprecated wrapper tool.

**Architecture:** 
1. Create `src/tools/consult_antigravity.ts` to execute `agy -p - --dangerously-skip-permissions` with directories resolved to `--add-dir` and session resolved to `--conversation`.
2. Clean up legacy `consult_gemini.ts` files, making `consult_gemini` a deprecated proxy in the new module.
3. Update registration, schemas, documentation, and the tests.

**Tech Stack:** TypeScript, MCP SDK, Vitest, Zod.

## Global Constraints
* SQL Formatting: Always copy-pasteable without line numbers or numbered comments (not applicable here, but listed for compliance).
* ESLint / TypeScript rules: Two-space indentation, strict TypeScript, ES modules.
* Path validation: Safe path resolution from `utils/file_reader.ts` must be maintained.

---

### Task 1: Create Antigravity Tool Module and Tests

**Files:**
* Create: `src/tools/consult_antigravity.ts`
* Create: `tests/tools/consult_antigravity.test.ts`

**Interfaces:**
* Produces:
  * `consultAntigravity(params: { prompt: string; files?: string[]; directory?: string; sessionId?: string; timeoutMs?: number }): Promise<{ response: string; sessionId: string }>`
  * `consultGemini(params: { prompt: string; files?: string[]; directory?: string; sessionId?: string; timeoutMs?: number }): Promise<{ response: string; sessionId: string }>`

- [ ] **Step 1: Create the new tool tests file**
  Create `tests/tools/consult_antigravity.test.ts` with the following Vitest tests:
  ```typescript
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

    it("returns stdout as the response for consultAntigravity", async () => {
      const result = await consultAntigravity({ prompt: "Hello" });
      expect(result.response).toBe("agy response");
    });

    it("calls agy with -p -, and passes the prompt via stdin", async () => {
      await consultAntigravity({ prompt: "Hello" });
      const [cmd, args, options] = mockRunCli.mock.calls[0];
      expect(cmd).toBe("agy");
      expect(args).toContain("-p");
      expect(args[args.indexOf("-p") + 1]).toBe("-");
      expect(args).toContain("--dangerously-skip-permissions");
      expect(options.stdin).toBe("Hello");
    });

    it("points to files and adds their directories via --add-dir", async () => {
      const tmpFile = join(testDir, `test-${Date.now()}.txt`);
      await writeFile(tmpFile, "agy file content");

      await consultAntigravity({ prompt: "Review this", files: [tmpFile] });
      const args = mockRunCli.mock.calls[0][1];
      const options = mockRunCli.mock.calls[0][2];

      expect(options.stdin).toContain("Review this");
      expect(options.stdin).toContain(tmpFile);
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
  ```

- [ ] **Step 2: Run the test to verify it fails**
  Run: `npx vitest run tests/tools/consult_antigravity.test.ts`
  Expected: FAIL with module resolution errors (target file does not exist).

- [ ] **Step 3: Create the implementation file**
  Create `src/tools/consult_antigravity.ts`:
  ```typescript
  import { resolveDirectorySafe } from "../utils/file_reader.js";
  import { runCli } from "../utils/run_cli.js";
  import { buildFileContext } from "../utils/prompt_builder.js";

  export async function consultAntigravity(params: {
    prompt: string;
    files?: string[];
    directory?: string;
    sessionId?: string;
    timeoutMs?: number;
  }): Promise<{ response: string; sessionId: string }> {
    const { prompt: fileContextPrompt, directories } = await buildFileContext(
      params.files ?? []
    );

    const stdinContent = fileContextPrompt
      ? `${params.prompt}\n\n${fileContextPrompt}`
      : params.prompt;

    const bin = process.env.ANTIGRAVITY_BIN ?? process.env.AGY_BIN ?? process.env.GEMINI_BIN ?? "agy";
    const dirArgs: string[] = [];
    if (params.directory) {
      const validatedDir = await resolveDirectorySafe(params.directory);
      dirArgs.push("--add-dir", validatedDir);
    }
    for (const dir of directories) {
      dirArgs.push("--add-dir", dir);
    }

    const baseArgs = [
      "-p",
      "-",
      "--dangerously-skip-permissions",
      ...dirArgs,
    ];

    if (params.sessionId) {
      baseArgs.push("--conversation", params.sessionId);
    }

    const timeoutMs = params.timeoutMs ?? (params.directory || directories.length > 0 ? 600_000 : 300_000);

    const res = await runCli(bin, baseArgs, { stdin: stdinContent, timeoutMs });
    return { response: res.stdout.trim(), sessionId: params.sessionId ?? "" };
  }

  /**
   * @deprecated Use consultAntigravity instead.
   */
  export async function consultGemini(params: {
    prompt: string;
    files?: string[];
    directory?: string;
    sessionId?: string;
    timeoutMs?: number;
  }): Promise<{ response: string; sessionId: string }> {
    console.warn(
      "[multi-ai-mcp] consult_gemini is deprecated and has been replaced by consult_antigravity. Please update your MCP client configuration."
    );
    return consultAntigravity(params);
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**
  Run: `npx vitest run tests/tools/consult_antigravity.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  Run:
  ```bash
  git add src/tools/consult_antigravity.ts tests/tools/consult_antigravity.test.ts
  git commit -m "feat(antigravity): implement consultAntigravity tool and tests"
  ```

---

### Task 2: Register Antigravity and Deprecated Gemini Tools

**Files:**
* Modify: `src/index.ts`

**Interfaces:**
* Consumes:
  * `consultAntigravity` and `consultGemini` from `./tools/consult_antigravity.js`

- [ ] **Step 1: Write the test changes**
  Since `tests/tools/consult_gemini.test.ts` needs to be deleted in Task 3, we can skip writing a failing test for registration itself and test compiled results after modifying `index.ts`.

- [ ] **Step 2: Update import statements in index.ts**
  Replace line 10 in `src/index.ts`:
  ```typescript
  import { consultGemini } from "./tools/consult_gemini.js";
  ```
  with:
  ```typescript
  import { consultAntigravity, consultGemini } from "./tools/consult_antigravity.js";
  ```

- [ ] **Step 3: Update disabled flag and registry checks**
  In `src/index.ts` around line 98, replace:
  ```typescript
  const disableGemini = process.argv.includes("--disable-gemini");
  ```
  with:
  ```typescript
  const disableGeminiFlag = process.argv.includes("--disable-gemini");
  const disableAntigravityFlag = process.argv.includes("--disable-antigravity");
  const disableAntigravity = disableGeminiFlag || disableAntigravityFlag;
  ```
  Update line 101 guard from:
  ```typescript
  if (disableCodex && disableGemini && disableClaude) {
  ```
  to:
  ```typescript
  if (disableCodex && disableAntigravity && disableClaude) {
  ```

- [ ] **Step 4: Update Zod Schema definitions**
  Replace the schemas around lines 121–130:
  ```typescript
  const ConsultAntigravitySchema = z.object({
    prompt: z.string().min(1).max(100_000),
    directory: z.string().min(1).max(4096).optional(),
    files: z.array(z.string().min(1).max(4096)).max(MAX_FILES).optional(),
    sessionId: z.string().uuid().optional(),
    timeoutMs: z.number().int().min(1).max(3600_000).optional(),
  }).strict().refine((data) => !(data.directory && data.files?.length), {
    message: "Provide 'directory' or 'files', not both. Prefer 'directory' for codebase tasks.",
    path: ["files"],
  });

  const ConsultGeminiSchema = ConsultAntigravitySchema;
  ```

- [ ] **Step 5: Update Tool Definitions**
  Define `antigravityToolDef` and update `geminiToolDef` around lines 170–188:
  ```typescript
  const antigravityToolDef = {
    name: "consult_antigravity",
    description:
      "Send a prompt to Antigravity (agy). ALWAYS prefer 'directory' for codebase-wide tasks or repository reviews. Use 'files' only for specific, surgical context (max 5 files). The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
        directory: { type: "string", minLength: 1, maxLength: 4096, description: "The root directory of the project. ALWAYS prefer this for codebase-wide tasks, repository reviews, or when you need to navigate multiple files. The agent will browse and index the directory itself." },
        files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: MAX_FILES, description: `Small set of specific files for surgical context. DO NOT use for broad codebase tasks. Max ${MAX_FILES} files. Do NOT include files already accessible via 'directory'.` },
        sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit or use a new UUID to start fresh." },
        timeoutMs: { type: "integer", minimum: 1, maximum: 3600_000, description: "Optional custom timeout in milliseconds for the CLI call (default: 300s, or 600s for codebase tasks)." },
      },
      required: ["prompt"],
      not: { required: ["directory", "files"] },
      additionalProperties: false,
    },
  };

  const geminiToolDef = {
    name: "consult_gemini",
    description:
      "[DEPRECATED] — Use consult_antigravity instead. Send a prompt to Google Gemini. ALWAYS prefer 'directory' for codebase-wide tasks or repository reviews. Use 'files' only for specific, surgical context (max 5 files). The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
        directory: { type: "string", minLength: 1, maxLength: 4096, description: "The root directory of the project. ALWAYS prefer this for codebase-wide tasks, repository reviews, or when you need to navigate multiple files. The agent will browse and index the directory itself." },
        files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: MAX_FILES, description: `Small set of specific files for surgical context. DO NOT use for broad codebase tasks. Max ${MAX_FILES} files. Do NOT include files already accessible via 'directory'.` },
        sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit or use a new UUID to start fresh." },
        timeoutMs: { type: "integer", minimum: 1, maximum: 3600_000, description: "Optional custom timeout in milliseconds for the CLI call (default: 300s, or 600s for codebase tasks)." },
      },
      required: ["prompt"],
      not: { required: ["directory", "files"] },
      additionalProperties: false,
    },
  };
  ```

- [ ] **Step 6: Update Tool Selection**
  In list tools handler around lines 210–215:
  ```typescript
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(!disableCodex ? [codexToolDef] : []),
      ...(!disableAntigravity ? [antigravityToolDef, geminiToolDef] : []),
      ...(!disableClaude ? [claudeToolDef] : []),
    ],
  }));
  ```

- [ ] **Step 7: Update Tool Router Cases**
  In call tool handler around lines 278–310:
  ```typescript
        case "consult_antigravity": {
          if (disableAntigravity) {
            return { content: [{ type: "text", text: "consult_antigravity is disabled" }], isError: true };
          }
          const parsed = ConsultAntigravitySchema.safeParse(args);
          if (!parsed.success) {
            const errorMsg = parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ");
            return {
              content: [{ type: "text", text: `Invalid arguments: ${errorMsg}` }],
              isError: true,
            };
          }
          const result = await withSessionLock(parsed.data.sessionId, () =>
            withSemaphore(async () => {
              const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
              try {
                return await consultAntigravity(parsed.data);
              } finally {
                clearInterval(ping);
              }
            })
          );
          let responseText = result.response;
          if ((parsed.data.files?.length ?? 0) >= 2 && !parsed.data.directory) {
            responseText += DIRECTORY_HINT;
          }
          const finalContent = result.sessionId
            ? `${responseText}\n\n[Session ID: ${result.sessionId}]`
            : responseText;
          return { content: [{ type: "text", text: finalContent }] };
        }
        case "consult_gemini": {
          if (disableAntigravity) {
            return { content: [{ type: "text", text: "consult_gemini is disabled" }], isError: true };
          }
          const parsed = ConsultGeminiSchema.safeParse(args);
          if (!parsed.success) {
            const errorMsg = parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ");
            return {
              content: [{ type: "text", text: `Invalid arguments: ${errorMsg}` }],
              isError: true,
            };
          }
          const result = await withSessionLock(parsed.data.sessionId, () =>
            withSemaphore(async () => {
              const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
              try {
                return await consultGemini(parsed.data);
              } finally {
                clearInterval(ping);
              }
            })
          );
          let responseText = result.response;
          if ((parsed.data.files?.length ?? 0) >= 2 && !parsed.data.directory) {
            responseText += DIRECTORY_HINT;
          }
          const finalContent = result.sessionId
            ? `${responseText}\n\n[Session ID: ${result.sessionId}]`
            : responseText;
          return { content: [{ type: "text", text: finalContent }] };
        }
  ```

- [ ] **Step 8: Run build and verify tests**
  Run: `npm run build && npm test`
  Expected: Success, but 14 legacy gemini tests might still pass (mocking runCli) while we haven't deleted the legacy files yet.

- [ ] **Step 9: Commit modifications**
  Run:
  ```bash
  git add src/index.ts
  git commit -m "feat(antigravity): register consult_antigravity tool and route flags in index.ts"
  ```

---

### Task 3: Delete Legacy Files and Run Full Test Suite

**Files:**
* Delete: `src/tools/consult_gemini.ts`
* Delete: `tests/tools/consult_gemini.test.ts`

- [ ] **Step 1: Delete the legacy files**
  Run:
  ```bash
  rm src/tools/consult_gemini.ts tests/tools/consult_gemini.test.ts
  ```

- [ ] **Step 2: Build the project and run the Vitest suite**
  Run: `npm run build && npm test`
  Expected: PASS with 7 test files, 0 failures.

- [ ] **Step 3: Commit deletions**
  Run:
  ```bash
  git add -A
  git commit -m "cleanup(gemini): delete legacy consult_gemini files"
  ```

---

### Task 4: Documentation and Config File Updates

**Files:**
* Rename & Modify: `GEMINI.md` $\rightarrow$ `ANTIGRAVITY.md`
* Modify: `README.md`
* Modify: `CLAUDE.md`
* Modify: `AGENTS.md`

- [ ] **Step 1: Rename GEMINI.md to ANTIGRAVITY.md and update contents**
  Run: `git mv GEMINI.md ANTIGRAVITY.md`
  Modify `ANTIGRAVITY.md` to replace references of `gemini` with `antigravity` or `agy`. Especially update:
  - Architecture: list `consult_antigravity.ts` (invokes `agy`) and the fallback.
  - Concurrency: replace "Per-session mutexes ensure that requests..." to reflect the new tool.
  - CLI Flags: include `--disable-antigravity`.
  - Global Configuration section: show adding `multi-ai-mcp` to `agy`'s configuration:
    ```bash
    agy mcp add --scope user multi-ai-mcp npx -- tsx src/index.ts --disable-antigravity
    ```

- [ ] **Step 2: Update README.md**
  Update tools list to add `consult_antigravity` and deprecate `consult_gemini`.
  Update example configurations replacing `--disable-gemini` with `--disable-antigravity`.

- [ ] **Step 3: Update CLAUDE.md**
  Update the environment variables table to include `ANTIGRAVITY_BIN` / `AGY_BIN`.
  Update the CLI flags and registration section to show `--disable-antigravity`.

- [ ] **Step 4: Update AGENTS.md**
  Replace `consult_gemini.ts` with `consult_antigravity.ts` in the project structure overview.

- [ ] **Step 5: Run tests and verify build**
  Run: `npm run build && npm test`
  Expected: PASS

- [ ] **Step 6: Commit documentation changes**
  Run:
  ```bash
  git add -A
  git commit -m "docs(antigravity): update documentation for antigravity CLI cutover"
  ```
