import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { consultCodex } from "./tools/consult_codex.js";
import { consultGemini } from "./tools/consult_gemini.js";

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
          prompt: { type: "string", description: "The question or request" },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Local file paths to include as text context",
          },
          images: {
            type: "array",
            items: { type: "string" },
            description: "Local image file paths (PNG/JPG) for vision input",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "consult_gemini",
      description:
        "Send a prompt to Google Gemini and get a text response. Optionally attach local files as context.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The question or request" },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Local file paths to include as text context",
          },
        },
        required: ["prompt"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "consult_codex": {
        const result = await consultCodex(
          args as Parameters<typeof consultCodex>[0]
        );
        return { content: [{ type: "text", text: result }] };
      }
      case "consult_gemini": {
        const result = await consultGemini(
          args as Parameters<typeof consultGemini>[0]
        );
        return { content: [{ type: "text", text: result }] };
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
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
