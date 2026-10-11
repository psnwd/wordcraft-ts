"use client";

import dynamic from "next/dynamic";

// The editor needs the browser (canvas + WASM), so no server rendering.
const Automation = dynamic(() => import("./Automation"), { ssr: false });

export default function Page() {
  return <Automation />;
}
