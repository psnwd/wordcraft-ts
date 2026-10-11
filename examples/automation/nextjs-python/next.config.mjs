// Where server.py listens. Override with PYTHON_API=http://host:port.
const PYTHON_API = process.env.PYTHON_API ?? "http://127.0.0.1:8000";

/** @type {import('next').NextConfig} */
export default {
  // wordcraft-ts ships ESM + a .wasm referenced via new URL(..., import.meta.url); let Next bundle it.
  transpilePackages: ["wordcraft-ts"],
  // The browser calls /api/* on the Next.js origin; Next forwards it to Python (no CORS, one URL).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${PYTHON_API}/api/:path*` }];
  },
};
