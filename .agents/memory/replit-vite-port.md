---
name: Replit IPv6 Vite Port Fix
description: @lovable.dev/vite-tanstack-config forces IPv6 host which fails on Replit; custom vite.config needed
---

The `@lovable.dev/vite-tanstack-config` package hardcodes `server: { host: "::", port: 8080 }` regardless of user config. Replit does not support IPv6, so this causes `EAFNOSUPPORT` error at startup.

**Fix:** Replace `vite.config.ts` to bypass the lovable package entirely:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsConfigPaths(),
    tanstackStart({ server: { entry: "server" } }),
    react(),
  ],
  server: { host: "0.0.0.0", port: 5000, strictPort: true, allowedHosts: "all" },
});
```

**Why:** Replit's network stack does not support IPv6 binding. The preview pane requires port 5000 with host 0.0.0.0.

**How to apply:** Any time a project uses @lovable.dev/vite-tanstack-config on Replit, immediately check for this issue and replace the vite.config with the above pattern.
