# Project: multi-ai-mcp

A TypeScript-based Model Context Protocol (MCP) server that provides tools to consult OpenAI Codex, Antigravity (agy), and Claude Code through their respective locally-installed CLIs.

## Project Overview

- **Purpose:** Bridges Claude (or any MCP client) to local `codex`, `agy`, and `claude` CLIs.
- **Architecture:** Node.js (ES modules) using the `@modelcontextprotocol/sdk`.
- **Inbound Communication:** Standard I/O (stdio) transport.
- **Outbound Communication:** Subprocess execution of `codex`, `agy`, and `claude` binaries.
- **Core Dependencies:** `@modelcontextprotocol/sdk`, `zod` (validation), `vitest` (testing), `tsx` (dev runner).

## Project Structure

- `src/index.ts`: The main entry point. Sets up the MCP server, registers tools, and handles request routing with concurrency management (semaphore and session locks).
- `src/tools/`: Contains the core logic for each tool.
    - `consult_codex.ts`: Invokes `codex exec`. Supports file context and image vision.
    - `consult_antigravity.ts`: Invokes `agy` (with `gemini` fallback). Supports file context and multi-turn sessions.
    - `consult_claude.ts`: Invokes `claude`. Supports file context, image vision, and repository-wide reviews.
- `src/utils/`: Shared utilities for the server.
    - `run_cli.ts`: Robust subprocess runner with timeout, buffer management, and process group termination.
    - `file_reader.ts`: Secure file and directory resolution with path traversal protection and size limits.
    - `prompt_builder.ts`: Helpers for constructing prompts with file context.
- `docs/superpowers/`: Contains detailed design specifications and project plans.
- `tests/`: Vitest-based tests mirroring the `src/` structure.

## Building and Running

- **Install Dependencies:** `npm install`
- **Development (Hot Reload):** `npm run dev` (uses `tsx` to run TypeScript directly).
- **Build:** `npm run build` (compiles to `dist/` using `tsc`).
- **Start:** `npm start` (runs the compiled `dist/index.js`).
- **Test:** `npm test` (runs all tests once using `vitest`).

## Development Conventions

- **Language:** Strict TypeScript.
- **Modules:** ES Modules (`type: "module"` in `package.json`).
- **File Naming:** Lowercase `snake_case` (e.g., `file_reader.ts`).
- **Exports:** Descriptive `camelCase` (e.g., `export function readFileContent`).
- **Validation:** Always use Zod for validating external inputs (like tool arguments).
- **Concurrency:**
    - A global semaphore limits the server to 3 simultaneous CLI calls to prevent system exhaustion.
    - Per-session mutexes ensure that requests for the same `sessionId` are processed sequentially to maintain conversation integrity for `consult_antigravity` and other tools.
- **Security:**
    - **Path Resolution:** Always use `resolvePathSafe`, `resolveImagePathSafe`, or `resolveDirectorySafe` from `utils/file_reader.ts` to prevent path traversal and ensure files are within the workspace or home directory.
    - **File Limits:** Text files are capped at 100KB; images are capped at 20MB.
    - **Symlinks:** The server avoids following symlinks that might lead outside the allowed roots.

## CLI Flags

The server supports the following optional CLI flags:
- `--disable-codex`: Disables the `consult_codex` tool.
- `--disable-antigravity`: Disables the `consult_antigravity` tool.
- `--disable-claude`: Disables the `consult_claude` tool.

## Global Configuration (Antigravity CLI)

To add this server to your global Antigravity CLI configuration (e.g., in `~/.gemini/settings.json`), you can use the following command:

```bash
agy mcp add --scope user multi-ai-mcp npx -- tsx src/index.ts --disable-antigravity
```

Ensure you set the `cwd` (current working directory) to the root of this project in the generated `settings.json`:

```json
"multi-ai-mcp": {
  "command": "npx",
  "args": [
    "tsx",
    "src/index.ts",
    "--disable-antigravity"
  ],
  "cwd": "/path/to/ai_mcp"
}
```

## Testing Guidelines

- Tests live in `tests/` and use the `.test.ts` extension.
- Use mocks for `child_process.spawn` or the `runCli` utility to keep tests deterministic and avoid calling actual CLIs.
- Ensure new features or bug fixes have corresponding test coverage in the appropriate `tests/tools/` or `tests/utils/` directory.
