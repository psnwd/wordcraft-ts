import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte()],
  // Keep the wasm glue out of dep pre-bundling so its `new URL("...wasm", import.meta.url)` still resolves.
  optimizeDeps: { exclude: ["wordcraft-ts"] },
});
