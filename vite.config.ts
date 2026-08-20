import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    plugins: [
      nodePolyfills({
        include: ["buffer"],
        globals: { Buffer: true, global: false, process: false },
      }),
      mcpPlugin(),
    ],
    server: {
      port: 3000,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  },
});
