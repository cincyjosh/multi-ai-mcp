# File Pointers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition MCP tools from embedding file content to pointing CLIs at file directories, bypassing size limits.

**Architecture:** Update `buildFileContext` to return validated paths and directories instead of strings; update tool wrappers to pass these directories as CLI flags and use the paths in the prompt.

**Tech Stack:** TypeScript, Node.js, MCP SDK.

---

### Task 1: Update `prompt_builder.ts`

**Files:**
- Modify: `src/utils/prompt_builder.ts`
- Test: `tests/utils/prompt_builder.test.ts`

- [ ] **Step 1: Update the return type and logic of `buildFileContext`**

```typescript
import { resolvePathSafe } from "./file_reader.js";
import { dirname } from "path";

export interface FileContext {
  prompt: string;
  directories: string[];
}

export async function buildFileContext(files: string[]): Promise<FileContext> {
  if (files.length === 0) return { prompt: "", directories: [] };

  const resolvedPaths = await Promise.all(files.map((f) => resolvePathSafe(f)));
  const directories = [...new Set(resolvedPaths.map((p) => dirname(p)))];

  const prompt = `The following files are relevant to this request and are accessible in your environment. Use your tools (like read_file or grep) to examine them if needed:\n${resolvedPaths.map(p => `- ${p}`).join("\n")}`;

  return { prompt, directories };
}
```

- [ ] **Step 2: Remove old constants and `readFileContent` usage from `prompt_builder.ts`**

- [ ] **Step 3: Update `tests/utils/prompt_builder.test.ts` to reflect new return type**

- [ ] **Step 4: Run tests**
Run: `npm test tests/utils/prompt_builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/utils/prompt_builder.ts tests/utils/prompt_builder.test.ts
git commit -m "refactor: change buildFileContext to return paths instead of content"
```

### Task 2: Update `consult_gemini.ts`

**Files:**
- Modify: `src/tools/consult_gemini.ts`

- [ ] **Step 1: Update `consultGemini` to handle the new `FileContext` object**

```typescript
// Inside consultGemini
const { prompt: fileContextPrompt, directories } = await buildFileContext(params.files ?? []);

const stdinContent = fileContextPrompt
  ? `${params.prompt}\n\n${fileContextPrompt}`
  : params.prompt;

// ...
const dirArgs: string[] = [];
if (params.directory) {
  const validatedDir = await resolveDirectorySafe(params.directory);
  dirArgs.push("--include-directories", validatedDir);
}
// Add directories from individual files
for (const dir of directories) {
  dirArgs.push("--include-directories", dir);
}
```

- [ ] **Step 2: Build and verify**
Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add src/tools/consult_gemini.ts
git commit -m "feat(gemini): support file pointing via --include-directories"
```

### Task 3: Update `consult_claude.ts`

**Files:**
- Modify: `src/tools/consult_claude.ts`

- [ ] **Step 1: Update `consultClaude` to handle the new `FileContext` object**

```typescript
// Inside consultClaude
const { prompt: fileContextPrompt, directories } = await buildFileContext(params.files ?? []);

let stdinContent = fileContextPrompt
  ? `${params.prompt}\n\n${fileContextPrompt}`
  : params.prompt;

// ...
if (params.directory) {
  addDirs.push(await resolveDirectorySafe(params.directory));
}
// Add directories from individual files
addDirs.push(...directories);
```

- [ ] **Step 2: Build and verify**
Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add src/tools/consult_claude.ts
git commit -m "feat(claude): support file pointing via --add-dir"
```

### Task 4: Update `consult_codex.ts`

**Files:**
- Modify: `src/tools/consult_codex.ts`

- [ ] **Step 1: Update `consultCodex` to handle the new `FileContext` object**

```typescript
// Inside consultCodex
const { prompt: fileContextPrompt, directories } = await buildFileContext(params.files ?? []);
const stdinContent = fileContextPrompt
  ? `${params.prompt}\n\n${fileContextPrompt}`
  : params.prompt;

// ...
if (params.directory) {
  const validatedDir = await resolveDirectorySafe(params.directory);
  dirArgs.push("-C", validatedDir);
}
// Add directories from individual files
for (const dir of directories) {
  dirArgs.push("--add-dir", dir);
}
```

- [ ] **Step 2: Build and verify**
Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Commit**
```bash
git add src/tools/consult_codex.ts
git commit -m "feat(codex): support file pointing via --add-dir"
```
