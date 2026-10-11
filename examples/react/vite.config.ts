import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Keep the wasm glue out of dep pre-bundling so its `new URL("...wasm", import.meta.url)` still resolves.
  optimizeDeps: { exclude: ["wordcraft-ts"] },
});
