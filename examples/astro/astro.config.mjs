import { defineConfig } from "astro/config";

export default defineConfig({
  vite: {
    // Keep the wasm glue out of dep pre-bundling so its `new URL("...wasm", import.meta.url)` still resolves.
    optimizeDeps: { exclude: ["wordcraft-ts"] },
  },
});
