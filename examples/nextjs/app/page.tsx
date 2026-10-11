"use client";

import dynamic from "next/dynamic";

// Needs the browser (canvas + WASM), so no server rendering.
const Workspace = dynamic(() => import("./Workspace"), { ssr: false });

export default function Page() {
  return <Workspace />;
}
