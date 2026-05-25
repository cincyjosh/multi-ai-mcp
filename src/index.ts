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
const sessionWaiters = new Map<string, number>();
const MAX_SESSION_WAITERS = 10;

async function withSessionLock<T>(
  sessionId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!sessionId) return fn();

  const count = sessionWaiters.get(sessionId) ?? 0;
  if (count >= MAX_SESSION_WAITERS) {
    throw new Error(`Too many pending requests for session ${sessionId}`);
  }
  sessionWaiters.set(sessionId, count + 1);

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
    const newCount = (sessionWaiters.get(sessionId) ?? 1) - 1;
    if (newCount <= 0) {
      sessionWaiters.delete(sessionId);
    } else {
      sessionWaiters.set(sessionId, newCount);
    }
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

const MAX_FILES = 5;

// --- Zod schemas for runtime validation ---
const ConsultCodexSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  directory: z.string().min(1).max(4096).optional(),
  files: z.array(z.string().min(1).max(4096)).max(MAX_FILES).optional(),
  images: z.array(z.string().min(1).max(4096)).max(10).optional(),
  sessionId: z.string().uuid().optional(),
}).strict().refine((data) => !(data.directory && data.files?.length), {
  message: "Provide 'directory' or 'files', not both. Prefer 'directory' for codebase tasks.",
  path: ["files"],
});

const ConsultGeminiSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  directory: z.string().min(1).max(4096).optional(),
  files: z.array(z.string().min(1).max(4096)).max(MAX_FILES).optional(),
  sessionId: z.string().uuid().optional(),
}).strict().refine((data) => !(data.directory && data.files?.length), {
  message: "Provide 'directory' or 'files', not both. Prefer 'directory' for codebase tasks.",
  path: ["files"],
});

const ConsultClaudeSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  directory: z.string().min(1).max(4096).optional(),
  files: z.array(z.string().min(1).max(4096)).max(MAX_FILES).optional(),
  images: z.array(z.string().min(1).max(4096)).max(10).optional(),
  sessionId: z.string().uuid().optional(),
}).strict().refine((data) => !(data.directory && data.files?.length), {
  message: "Provide 'directory' or 'files', not both. Prefer 'directory' for codebase tasks.",
  path: ["files"],
});

// --- Server setup ---
const server = new Server(
  { name: "multi-ai-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

const codexToolDef = {
  name: "consult_codex",
  description:
    "Send a prompt to OpenAI Codex. ALWAYS prefer 'directory' for codebase-wide tasks or repository reviews. Use 'files' only for specific, surgical context (max 5 files). The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
      directory: { type: "string", minLength: 1, maxLength: 4096, description: "The root directory of the project. ALWAYS prefer this for codebase-wide tasks, repository reviews, or when you need to navigate multiple files. The agent will browse and index the directory itself." },
      files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: MAX_FILES, description: `Small set of specific files for surgical context. DO NOT use for broad codebase tasks. Max ${MAX_FILES} files. Do NOT include files already accessible via 'directory'.` },
      images: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 10, description: "Local image file paths (PNG/JPG/WEBP/GIF) for vision input" },
      sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit or use a new UUID to start fresh." },
    },
    required: ["prompt"],
    not: { required: ["directory", "files"] },
    additionalProperties: false,
  },
};

const geminiToolDef = {
  name: "consult_gemini",
  description:
    "Send a prompt to Google Gemini. ALWAYS prefer 'directory' for codebase-wide tasks or repository reviews. Use 'files' only for specific, surgical context (max 5 files). The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
      directory: { type: "string", minLength: 1, maxLength: 4096, description: "The root directory of the project. ALWAYS prefer this for codebase-wide tasks, repository reviews, or when you need to navigate multiple files. The agent will browse and index the directory itself." },
      files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: MAX_FILES, description: `Small set of specific files for surgical context. DO NOT use for broad codebase tasks. Max ${MAX_FILES} files. Do NOT include files already accessible via 'directory'.` },
      sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit or use a new UUID to start fresh." },
    },
    required: ["prompt"],
    not: { required: ["directory", "files"] },
    additionalProperties: false,
  },
};

const claudeToolDef = {
  name: "consult_claude",
  description:
    "Send a prompt to Claude Code. ALWAYS prefer 'directory' for codebase-wide tasks or repository reviews. Use 'files' only for specific, surgical context (max 5 files). The response includes a [Session ID: ...] footer when a session is active — pass that UUID back as sessionId on the next call to continue the conversation.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", minLength: 1, maxLength: 100_000, description: "The question or request" },
      directory: { type: "string", minLength: 1, maxLength: 4096, description: "The root directory of the project. ALWAYS prefer this for codebase-wide tasks, repository reviews, or when you need to navigate multiple files. Claude Code will have full access to this directory." },
      files: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: MAX_FILES, description: `Small set of specific files for surgical context. DO NOT use for broad codebase tasks. Max ${MAX_FILES} files. Do NOT include files already accessible via 'directory'.` },
      images: { type: "array", items: { type: "string", minLength: 1, maxLength: 4096 }, maxItems: 10, description: "Local image file paths (PNG/JPG/WEBP/GIF) for vision input" },
      sessionId: { type: "string", format: "uuid", description: "UUID to identify a conversation. Reuse across calls to maintain context; omit for a stateless one-shot call." },
    },
    required: ["prompt"],
    not: { required: ["directory", "files"] },
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

const DIRECTORY_HINT = "\n\n[Hint: For broad tasks involving multiple files, prefer the 'directory' parameter over individual 'files' for better efficiency.]";

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
        const result = await withSessionLock(parsed.data.sessionId, () =>
          withSemaphore(async () => {
            const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
            try {
              return await consultCodex(parsed.data);
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
        const result = await withSessionLock(parsed.data.sessionId, () =>
          withSemaphore(async () => {
            const ping = startProgressPing(progressToken, (n) => server.notification(n as any));
            try {
              return await consultClaude(parsed.data);
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
