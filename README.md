# Multi AI MCP

`multi-ai-mcp` is a stdio MCP server that exposes local AI CLIs as MCP tools. It currently supports OpenAI Codex, Google Gemini, and Claude Code, so an MCP client can ask another local agent for review, comparison, or follow-up work without managing separate terminal sessions.

## Tools

- `consult_codex`: calls the `codex` CLI. Supports `prompt`, `files`, `images`, `directory`, and `sessionId`.
- `consult_gemini`: calls the `gemini` CLI. Supports `prompt`, `files`, `directory`, and `sessionId`.
- `consult_claude`: calls the `claude` CLI. Supports `prompt`, `files`, `images`, `directory`, and `sessionId`.

All tools validate inputs with Zod. File and image paths are resolved through the repository's safe file readers before being passed to a CLI. Supplying `sessionId` lets the server continue a named conversation where the underlying CLI supports it.

## Requirements

- Node.js 22 or newer.
- Local CLI authentication for any enabled tool: `codex`, `gemini`, and/or `claude`.
- `rg` is recommended because downstream CLIs may use it for repository search.

## Setup

```bash
npm install
npm run build
```

Run tests with:

```bash
npm test
```

Run the compiled server directly:

```bash
npm start
```

For development without a build step:

```bash
npm run dev
```

## Disable Flags

Use flags to expose only selected tools:

```bash
node dist/index.js --disable-codex
node dist/index.js --disable-gemini
node dist/index.js --disable-claude
```

The server exits if all three tools are disabled.

## Codex MCP Registration

This repository is currently useful from Codex with Codex disabled, so Codex can consult Gemini and Claude without recursively calling itself:

```bash
codex mcp add multi-ai-mcp -- node /absolute/path/to/ai_mcp/dist/index.js --disable-codex
```

After changing TypeScript source, run `npm run build` and restart or reload the MCP client so it sees the updated `dist/` files.

## Notes

Long-running directory reviews can take several minutes. The server sends progress notifications every 15 seconds and allows up to 10 minutes for calls that include `directory`, but individual MCP clients may enforce their own shorter request timeout.
