import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { consultClaude } from "./tools/consult_claude.js";
import { consultCodex } from "./tools/consult_codex.js";
import { consultGemini } from "./tools/consult_gemini.js";

// --- Concurrency semaphore (max 3 simultaneous CLI calls, max 10 queued) ---
class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];
  private readonly maxQueue: number;

  constructor(max: number, maxQueue = 10) {
    this.count = max;
    this.maxQueue = maxQueue;
  }

  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
    }
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(new Error("Server busy: too many pending requests"));
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.count++;
    }
  }
}

const semaphore = new Semaphore(3);

async function withSemaphore<T>(fn: () => Promise<T>): Promise<T> {
  await semaphore.acquire();
  try {
    return await fn();
  } finally {
    semaphore.release();
  }
}

// Per-session mutex: prevents two concurrent requests for the same sessionId
// from mutating the same underlying CLI conversation simultaneously.
const sessionLocks = new Map<string, Promise<void>>();

async function withSessionLock<T>(
  sessionId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!sessionId) return fn();
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => { release = r; });
  const chained = prev.then(() => current, () => current);
  sessionLocks.set(sessionId, chained);
  await prev.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    // Remove the entry only if no newer waiter has replaced it
    if (sessionLocks.get(sessionId) === chained) {
      sessionLocks.delete(sessionId);
    }
  }
}

// --- CLI flags ---
const disableCodex = process.argv.includes("--disable-codex");
const disableGemini = process.argv.includes("--disable-gemini");
const disableClaude = process.argv.includes("--disable-claude");

if (disableCodex && disableGemini && disableClaude) {
  console.error("[multi-ai-mcp] All tools disabled — nothing to serve. Exiting.");
  process.exit(1);
}

// --- Zod schemas for runtime validation ---
const ConsultCodexSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  files: z.array(z.string().min(1).max(4096)).max(20).optional(),
  images: z.array(z.string().min(1).max(4096)).max(10).optional(),
  directory: z.string().min(1).max(4096).optional(),
  sessionId: z.string().uuid().optional(),
}).strict();

const ConsultGeminiSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  files: z.array(z.string().min(1).max(4096)).max(20).optional(),
  directory: z.string().min(1).max(4096).optional(),
  sessionId: z.string().uuid().optional(),
}).strict();

const ConsultClaudeSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  files: z.array(z.string().min(1).max(4096)).max(20).optional(),
  images: z.array(z.string().min(1).max(4096)).max(10).optional(),
  directory: z.string().min(1).max(4096).optional(),
  sessionId: z.string().uuid().optional(),
}).strict();

// --- Server setup ---
const server = new Server(
  { name: "multi-ai-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const codexToolDef = {
  name: "consult_codex",
  description:
    "Send a prompt to OpenAI Codex and get a text response. Optionally attach local files as context or images for vision input. Pass sessionId to continue a previous conversation; omit it for a stateless one-shot call. The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
      files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 20, description: "Local file paths to include as text context" },
      images: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 10, description: "Local image file paths (PNG/JPG/WEBP/GIF) for vision input" },
      directory: { type: "string", minLength: 1, maxLength: 4096, description: "Local directory path to pass as the agent working root (e.g. a repo to review). The agent browses the directory itself — no file size limits apply." },
      sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit or use a new UUID to start fresh." },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

const geminiToolDef = {
  name: "consult_gemini",
  description:
    "Send a prompt to Google Gemini and get a text response. Optionally attach local files as context. Pass sessionId to continue a previous conversation; omit it for a stateless one-shot call. The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
      files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 20, description: "Local file paths to include as text context" },
      directory: { type: "string", minLength: 1, maxLength: 4096, description: "Local directory path to include in the workspace context (e.g. a repo to review). The agent browses the directory itself — no file size limits apply." },
      sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit or use a new UUID to start fresh." },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

const claudeToolDef = {
  name: "consult_claude",
  description:
    "Send a prompt to Claude Code and get a text response. Optionally attach local files as context or include a local directory. Pass sessionId to continue a previous conversation; omit it for a stateless one-shot call. The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
      files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 20, description: "Local file paths to include as text context" },
      images: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 10, description: "Local image file paths (PNG/JPG/WEBP/GIF) for vision input" },
      directory: { type: "string", minLength: 1, maxLength: 4096, description: "Local directory path to allow Claude Code to access for workspace context." },
      sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit for a stateless one-shot call." },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...(!disableCodex ? [codexToolDef] : []),
    ...(!disableGemini ? [geminiToolDef] : []),
    ...(!disableClaude ? [claudeToolDef] : []),
  ],
}));

const PROGRESS_INTERVAL_MS = 15_000;

function startProgressPing(
  progressToken: string | number | undefined,
  sendNotification: (n: { method: string; params: object }) => Promise<void>
): ReturnType<typeof setInterval> | undefined {
  if (progressToken == null) return undefined;
  const startedAt = Date.now();
  let inFlight = false;
  return setInterval(() => {
    if (inFlight) return;
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    inFlight = true;
    sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress: elapsed, message: `Still processing… (${elapsed}s)` },
    }).catch(() => {}).finally(() => { inFlight = false; });
  }, PROGRESS_INTERVAL_MS);
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const progressToken = request.params._meta?.progressToken;

  try {
    switch (name) {
      case "consult_codex": {
        if (disableCodex) {
          return { content: [{ type: "text", text: "consult_codex is disabled" }], isError: true };
        }
        const parsed = ConsultCodexSchema.safeParse(args);
        if (!parsed.success) {
          const errorMsg = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return {
            content: [{ type: "text", text: `Invalid arguments: ${errorMsg}` }],
            isError: true,
          };
        }
        const result = await withSemaphore(async () => {
          const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
          try {
            return await withSessionLock(parsed.data.sessionId, () => consultCodex(parsed.data));
          } finally {
            clearInterval(ping);
          }
        });
        const codexText = result.sessionId
          ? `${result.response}\n\n[Session ID: ${result.sessionId}]`
          : result.response;
        return { content: [{ type: "text", text: codexText }] };
      }
      case "consult_gemini": {
        if (disableGemini) {
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
        const result = await withSemaphore(async () => {
          const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
          try {
            return await withSessionLock(parsed.data.sessionId, () => consultGemini(parsed.data));
          } finally {
            clearInterval(ping);
          }
        });
        const geminiText = result.sessionId
          ? `${result.response}\n\n[Session ID: ${result.sessionId}]`
          : result.response;
        return { content: [{ type: "text", text: geminiText }] };
      }
      case "consult_claude": {
        if (disableClaude) {
          return { content: [{ type: "text", text: "consult_claude is disabled" }], isError: true };
        }
        const parsed = ConsultClaudeSchema.safeParse(args);
        if (!parsed.success) {
          const errorMsg = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          return {
            content: [{ type: "text", text: `Invalid arguments: ${errorMsg}` }],
            isError: true,
          };
        }
        const result = await withSemaphore(async () => {
          const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
          try {
            return await withSessionLock(parsed.data.sessionId, () => consultClaude(parsed.data));
          } finally {
            clearInterval(ping);
          }
        });
        const claudeText = result.sessionId
          ? `${result.response}\n\n[Session ID: ${result.sessionId}]`
          : result.response;
        return { content: [{ type: "text", text: claudeText }] };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    console.error(`[multi-ai-mcp] Tool error (${name}):`, error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport).catch((err) => {
  console.error("[multi-ai-mcp] Failed to start server:", err);
  process.exit(1);
});
