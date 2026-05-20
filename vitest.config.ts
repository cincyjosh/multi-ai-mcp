import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      MCP_WORKSPACE_ROOT: "/",
    },
  },
});
