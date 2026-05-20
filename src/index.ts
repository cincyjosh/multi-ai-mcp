import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { consultCodex } from "./tools/consult_codex.js";
import { consultGemini } from "./tools/consult_gemini.js";

// --- Concurrency semaphore (max 3 simultaneous CLI calls) ---
class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.count = max;
  }

  acquire(): Promise<void> {
    if (this.count > 0) {
      this.count--;
      return Promise.resolve();
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

// --- Zod schemas for runtime validation ---
const ConsultCodexSchema = z.object({
  prompt: z.string().min(1),
  files: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
}).strict();

const ConsultGeminiSchema = z.object({
  prompt: z.string().min(1),
  files: z.array(z.string()).optional(),
}).strict();

// --- Server setup ---
const server = new Server(
  { name: "multi-ai-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "consult_codex",
      description:
        "Send a prompt to OpenAI Codex and get a text response. Optionally attach local files as context or images for vision input.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "The question or request",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Local file paths to include as text context",
          },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Local image file paths (PNG/JPG/WEBP/GIF) for vision input",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
    {
      name: "consult_gemini",
      description:
        "Send a prompt to Google Gemini and get a text response. Optionally attach local files as context.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            minLength: 1,
            description: "The question or request",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Local file paths to include as text context",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "consult_codex": {
        const parsed = ConsultCodexSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
            isError: true,
          };
        }
        const result = await withSemaphore(() => consultCodex(parsed.data));
        return { content: [{ type: "text", text: result }] };
      }
      case "consult_gemini": {
        const parsed = ConsultGeminiSchema.safeParse(args);
        if (!parsed.success) {
          return {
            content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }],
            isError: true,
          };
        }
        const result = await withSemaphore(() => consultGemini(parsed.data));
        return { content: [{ type: "text", text: result }] };
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
await server.connect(transport);
