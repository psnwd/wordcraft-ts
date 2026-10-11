/** @type {import('next').NextConfig} */
export default {
  // wordcraft-ts ships ESM + a .wasm referenced via new URL(..., import.meta.url); let Next bundle it.
  transpilePackages: ["wordcraft-ts"],
};
