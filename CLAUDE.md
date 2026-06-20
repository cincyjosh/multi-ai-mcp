# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev          # run TypeScript directly with tsx (development)
npm run build        # compile to dist/ with tsc
npm start            # run compiled dist/index.js
npm test             # run full Vitest suite once
npx vitest run tests/utils/run_cli.test.ts   # run a single test file
```

Run `npm run build && npm test` before submitting behavior changes.

## Architecture

This is a TypeScript MCP server (`multi-ai-mcp`) that bridges MCP clients to locally-installed AI CLIs (`codex`, `agy`, `claude`) via subprocess execution over stdio transport.

**Entry point:** `src/index.ts` — registers tools, validates inputs with Zod, and orchestrates concurrency.

**Tool implementations** (`src/tools/`):
- Each tool wraps a CLI subprocess call, injects file context via stdin, manages sessions, and returns `{ response, sessionId }`.

**Shared utilities** (`src/utils/`):
- `run_cli.ts` — subprocess runner; uses a state machine (running → failing → closed) to ensure the Promise never settles until the child process has actually exited. Kills via process group (`-pid`) to reach child subprocesses, with SIGTERM → SIGKILL escalation.
- `file_reader.ts` — path resolution with workspace-root confinement (`MCP_WORKSPACE_ROOT` env var, defaults to `cwd`). Uses `O_NOFOLLOW` after `realpath` to prevent TOCTOU symlink attacks.
- `prompt_builder.ts` — concatenates file contents into `<file path="...">` XML blocks and prepends to stdin.

## Concurrency Model

Two layers in `src/index.ts`:
1. **Global semaphore** — caps at 3 simultaneous CLI calls (max 10 queued); prevents system exhaustion.
2. **Per-session mutex** — chains promises by `sessionId` so concurrent requests for the same session are serialised.

## Session Handling (differs per tool)

- **consult_claude**: uses `--session-id <uuid>` to resume; `--no-session-persistence` for stateless calls. Session IDs are caller-supplied UUIDs passed directly to the CLI.
- **consult_antigravity**: uses `--conversation <uuid>` to resume or start a session.
- **consult_codex**: maps caller UUID → codex-internal UUID via byte-offset diffing of `~/.codex/session_index.jsonl`. A module-level creation mutex prevents two concurrent new-session calls from swapping IDs.

## Security Constraints

- All file and directory paths go through `resolvePathSafe` / `resolveDirectorySafe` / `resolveImagePathSafe` — never bypass these for user-supplied paths.
- Size limits enforced: text files 100 KB each, total file context 500 KB, images 20 MB, CLI stdout/stderr buffers 10 MB each.
- Codex image inputs are copied to a temp dir first to prevent the CLI from following symlinks to arbitrary paths.

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_BIN` | `claude` | Path to the Claude Code CLI |
| `CODEX_BIN` | `codex` | Path to the Codex CLI |
| `ANTIGRAVITY_BIN` / `AGY_BIN` | `agy` | Path to the Antigravity CLI |
| `GEMINI_BIN` | `gemini` | Path to the Gemini CLI (fallback) |
| `MCP_WORKSPACE_ROOT` | `process.cwd()` | Root for path traversal checks |
| `CODEX_HOME` | `~/.codex` | Codex session index location |

## CLI Flags

Pass when starting the server to disable individual tools:
```
--disable-codex   --disable-antigravity   --disable-claude
```
All three disabled at once causes the server to exit immediately.

## Registering the Server

Example for Antigravity CLI (in `~/.gemini/settings.json`):
```json
"multi-ai-mcp": {
  "command": "npx",
  "args": ["tsx", "src/index.ts", "--disable-antigravity"],
  "cwd": "/path/to/ai_mcp"
}
```

## Testing Conventions

Tests mock `runCli` via `vi.hoisted` + `vi.mock` to avoid spawning real CLI processes. Each tool test creates files under a dedicated temp dir (e.g., `.mcp-test-tmp-gemini/`) using `process.cwd()` as the workspace root so path validation passes.
