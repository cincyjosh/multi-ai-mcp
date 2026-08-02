# Multi AI MCP

`multi-ai-mcp` is a stdio MCP server that exposes local AI CLIs as MCP tools. It currently supports OpenAI Codex, Antigravity (agy), and Claude Code, so an MCP client can ask another local agent for review, comparison, or follow-up work without managing separate terminal sessions.

## Tools

- `consult_codex`: calls the `codex` CLI. Supports `prompt`, `files`, `images`, `directory`, and `sessionId`.
- `consult_antigravity`: calls the `agy` CLI. Supports `prompt`, `files`, `directory`, and `sessionId`.
- `consult_gemini` (deprecated): compatibility alias for `consult_antigravity`. Supports `prompt`, `files`, `directory`, and `sessionId`.
- `consult_claude`: calls the `claude` CLI. Supports `prompt`, `files`, `images`, `directory`, and `sessionId`.

All tools validate inputs with Zod. File and image paths are resolved through the repository's safe file readers before being passed to a CLI. Supplying `sessionId` lets the server continue a named conversation where the underlying CLI supports it.

## Requirements

- Node.js 22 or newer.
- Local CLI authentication for any enabled tool: `codex`, `agy`, and/or `claude`.

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
node dist/index.js --disable-antigravity
node dist/index.js --disable-claude
```

The server exits if all three primary tools are disabled. Disabling Antigravity also disables the deprecated `consult_gemini` alias.

## MCP Client Registration

Register the compiled stdio server with any MCP client:

```bash
node /absolute/path/to/ai_mcp/dist/index.js
```

When registering this server inside one of the same AI CLIs it exposes, disable that matching tool to avoid recursive calls:

```bash
# From Codex: expose Antigravity and Claude.
codex mcp add multi-ai-mcp -- node /absolute/path/to/ai_mcp/dist/index.js --disable-codex

# From Claude Code: expose Codex and Antigravity.
claude mcp add multi-ai-mcp -- node /absolute/path/to/ai_mcp/dist/index.js --disable-claude

# From Antigravity (agy): expose Codex and Claude.
agy mcp add multi-ai-mcp node /absolute/path/to/ai_mcp/dist/index.js --disable-antigravity
```

After changing TypeScript source, run `npm run build` and restart or reload the MCP client so it sees the updated `dist/` files.

## Notes

Long-running directory reviews can take several minutes. The server sends progress notifications every 15 seconds and allows up to 10 minutes for calls that include `directory`, but individual MCP clients may enforce their own shorter request timeout.
