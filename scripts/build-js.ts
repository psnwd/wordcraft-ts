// tsc emits dist/index.js + .d.ts and copies the allowJs wasm glue; add the .wasm and its types.
import { $ } from "bun";
import { cp, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await $`bunx tsc -p .`;
await cp("src/wasm", "dist/wasm", { recursive: true });
