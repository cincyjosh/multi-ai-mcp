# Specification: Antigravity CLI (agy) Cutover Refactoring

This document describes the design for transitioning the `multi-ai-mcp` server to support the new `antigravity` (`agy`) CLI, replacing the legacy `gemini` CLI while maintaining a deprecated fallback for backwards compatibility.

## Goals
1. Support the new `antigravity` (`agy`) CLI.
2. Introduce the `consult_antigravity` MCP tool as the primary interface for contacting the `agy` CLI.
3. Maintain the `consult_gemini` MCP tool as a deprecated fallback wrapper that delegates to `consult_antigravity`.
4. Update configuration flags, environment variables, documentation, and tests.

---

## 1. Tool Behavior & CLI Flags Mapping

The `gemini` CLI is cut over to the `agy` CLI. The CLI options map as follows:

| Legacy `gemini` Option | New `agy` Option | Purpose |
|:---|:---|:---|
| `gemini` | `agy` | Default binary name |
| `-p - -o text` | `-p -` | Non-interactive print mode reading prompt from stdin |
| `--include-directories <dir>` | `--add-dir <dir>` | Supply workspace directories for context |
| `--session-id <id>` / `--resume <id>` | `--conversation <id>` | Resume or start an isolated conversation thread |
| `--skip-trust --approval-mode plan` | `--dangerously-skip-permissions` | Bypasses interactive prompts for tool permissions in background runs |

---

## 2. Codebase Refactoring

### A. Rename Files
* `src/tools/consult_gemini.ts` $\rightarrow$ `src/tools/consult_antigravity.ts`
* `tests/tools/consult_gemini.test.ts` $\rightarrow$ `tests/tools/consult_antigravity.test.ts`

### B. Tool Implementation (`src/tools/consult_antigravity.ts`)
* **Binary Path Resolution:**
  ```typescript
  const bin = process.env.ANTIGRAVITY_BIN ?? process.env.AGY_BIN ?? process.env.GEMINI_BIN ?? "agy";
  ```
* **Base Arguments:**
  ```typescript
  const baseArgs = ["-p", "-", "--dangerously-skip-permissions"];
  ```
* **Directory Arguments:** Add directories using `--add-dir`.
* **Session Arguments:** If `sessionId` is provided, append `["--conversation", sessionId]`.
* **Exports:**
  * `consultAntigravity(params)`: The primary tool runner.
  * `consultGemini(params)`: Wraps `consultAntigravity` but outputs a deprecation notice:
    > "Note: consult_gemini is deprecated and has been replaced by consult_antigravity. Please update your MCP client configuration."

### C. Server Registry (`src/index.ts`)
* **Flag Handling:** Check both `--disable-antigravity` and `--disable-gemini`. Disable the tools if either is set.
* **Schemas:** Define `ConsultAntigravitySchema` (same structure as Codex/Claude: `prompt`, `directory`, `files`, `sessionId`, `timeoutMs`). `ConsultGeminiSchema` remains an alias.
* **Tool Definitions:** Expose both `consult_antigravity` and `consult_gemini`.
* **Handler Mapping:** Map `consult_antigravity` and `consult_gemini` to their respective tool runners in `src/tools/consult_antigravity.ts`.

### D. Testing (`tests/tools/consult_antigravity.test.ts`)
* Verify `consultAntigravity` correctly maps arguments (`-p -`, `--dangerously-skip-permissions`, `--add-dir`, `--conversation`).
* Verify `consultGemini` triggers the deprecation warning and delegates correctly.

---

## 3. Documentation & Rules
* Rename `GEMINI.md` to `ANTIGRAVITY.md` (and update all inner references to `gemini` to `antigravity` or `agy`).
* Update references in `README.md` and `AGENTS.md`.
