// Rust -> wasm32 -> wasm-bindgen glue in ./wasm. Needs: rustup target wasm32-unknown-unknown,
// wasm-bindgen-cli 0.2.129 (matches Cargo.lock). Optional: wasm-opt (binaryen) shrinks the file.
import { $ } from "bun";
import { cp } from "node:fs/promises";

const SRC = process.env.WORDCRAFT_SRC ?? "../wordcraft-src";
// The embed crate lives in ./rust; drop it into the upstream workspace (members = apps/*).
await cp("rust/wordcraft-embed", `${SRC}/apps/wordcraft-embed`, { recursive: true });
await $`cargo build -p wordcraft-embed --target wasm32-unknown-unknown --release`.cwd(SRC);
await $`wasm-bindgen ${SRC}/target/wasm32-unknown-unknown/release/wordcraft_embed.wasm --target web --out-dir src/wasm --out-name wordcraft_embed --remove-name-section --remove-producers-section`;
const wasmOpt = Bun.which("wasm-opt", { PATH: `node_modules/.bin${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` });
if (wasmOpt && !process.env.SKIP_OPT) {
  const f = "src/wasm/wordcraft_embed_bg.wasm";
  await $`${wasmOpt} -Oz --enable-bulk-memory --enable-reference-types --enable-nontrapping-float-to-int --enable-sign-ext --enable-mutable-globals --enable-multivalue -o ${f} ${f}`;
}
