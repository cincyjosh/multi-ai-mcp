# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript MCP server for consulting multiple AI CLIs. Source code lives in `src/`: `src/index.ts` wires the server together, `src/tools/` contains tool implementations such as `consult_codex.ts` and `consult_gemini.ts`, and `src/utils/` contains shared helpers for CLI execution, prompt construction, and file reading. Tests mirror the source layout under `tests/tools/` and `tests/utils/`. Built JavaScript is emitted to `dist/`; treat it as generated output from `npm run build`.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: run the TypeScript entrypoint directly with `tsx` for local development.
- `npm run build`: compile TypeScript with `tsc` into `dist/`.
- `npm start`: run the compiled server from `dist/index.js`.
- `npm test`: run the Vitest suite once.

Run `npm run build` and `npm test` before submitting behavior changes.

## Coding Style & Naming Conventions

Use strict TypeScript and ES modules. Keep files focused by responsibility: tool entrypoints belong in `src/tools/`, shared behavior in `src/utils/`. Follow the existing naming pattern of lowercase snake_case filenames, for example `prompt_builder.ts`, and descriptive camelCase exports inside modules. Prefer explicit validation with Zod for external inputs and typed return values for public helpers. Preserve the current formatting style: two-space indentation, semicolons, and concise guard clauses.

## Testing Guidelines

Tests use Vitest and live in `tests/` with filenames ending in `.test.ts`. Add or update tests next to the related area, for example `tests/utils/run_cli.test.ts` for `src/utils/run_cli.ts`. Cover normal behavior, validation failures, and security-sensitive path or command handling when touched. Use mocks or fakes for external CLI calls so tests stay deterministic.

## Commit & Pull Request Guidelines

Recent commits use short Conventional Commit prefixes such as `feat:` and `fix:` followed by an imperative summary, for example `fix: harden security, unify CLI input patterns, and improve error reporting`. Keep commits focused and mention tests in the PR description. Pull requests should explain the user-visible change, list validation performed, link related issues or docs, and include screenshots or logs only when they clarify CLI/server behavior.

## Security & Configuration Tips

Be careful with file paths, shell arguments, and prompt content passed to external CLIs. Reuse existing path validation and CLI execution utilities instead of bypassing them. Do not commit secrets, local credentials, or machine-specific configuration.
