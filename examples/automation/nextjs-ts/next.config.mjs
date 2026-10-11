/** @type {import('next').NextConfig} */
export default {
  // wordcraft-ts ships ESM + a .wasm referenced via new URL(..., import.meta.url); let Next bundle it.
  transpilePackages: ["wordcraft-ts"],
  // native module (draws the charts): load it from node_modules instead of bundling it
  serverExternalPackages: ["@resvg/resvg-js"],
};
