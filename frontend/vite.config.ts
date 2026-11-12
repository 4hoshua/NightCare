import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // Polling also detects edits from Windows/WSL through Docker Desktop.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      "/api": "http://backend:3000",
      "/ui-config": "http://backend:3000",
      "/health": "http://backend:3000",
      "/dashboard": "http://backend:3000",
      "^/ws$": { target: "http://backend:3000", ws: true },
    },
  },
});
