import { defineConfig } from "vite";

export default defineConfig({
  // Keep the wasm glue out of dep pre-bundling so its `new URL("...wasm", import.meta.url)` still resolves.
  optimizeDeps: { exclude: ["wordcraft-ts"] },
  build: { target: "es2022" }, // top-level await in main.ts
  // The Python server (server.py) answers /api.
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
  preview: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
