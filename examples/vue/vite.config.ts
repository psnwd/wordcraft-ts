import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  // Keep the wasm glue out of dep pre-bundling so its `new URL("...wasm", import.meta.url)` still resolves.
  optimizeDeps: { exclude: ["wordcraft-ts"] },
});
