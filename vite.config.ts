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
    build: {
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (
            warning.code === "MODULE_LEVEL_DIRECTIVE" ||
            warning.message?.includes('"use client"')
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
    server: {
      port: 5000,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  },
});
