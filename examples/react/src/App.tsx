import { useEffect, useRef, useState } from "react";
import { mountEditor, type WordCraftEditor } from "wordcraft-ts";

const FORMATS = ["docx", "odt", "rtf", "html", "md", "txt"];

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const editor = useRef<WordCraftEditor | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("loading…");
  const [dirty, setDirty] = useState(false);
  const [format, setFormat] = useState("docx");

  useEffect(() => {
    let cancelled = false;
    let ed: WordCraftEditor | undefined;
    mountEditor(canvas.current!, { sample: true })
      .then((e) => {
        if (cancelled) return e.destroy(); // StrictMode runs effects twice in dev
        ed = editor.current = e;
        e.onDirty(setDirty);
        setStatus("ready");
      })
      .catch((e) => !cancelled && setStatus(`failed: ${e}`));
    return () => {
      cancelled = true;
      ed?.destroy();
    };
  }, []);

  async function exportDoc() {
    const blob = await editor.current!.exportBlob(format);
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `document.${format}` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="app">
      <div className="bar">
        <span className="brand">WordCraft · React</span>
        <button onClick={() => fileInput.current?.click()}>Open…</button>
        <input ref={fileInput} type="file" hidden accept=".docx,.odt,.rtf,.md,.txt,.html"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) editor.current?.load(f); e.target.value = ""; }} />
        <span className="spacer" />
        <span className="status">{dirty && <i className="dot" />}{status}{dirty ? " · unsaved" : ""}</span>
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {FORMATS.map((f) => <option key={f} value={f}>.{f}</option>)}
        </select>
        <button className="primary" disabled={status !== "ready"} onClick={exportDoc}>Export</button>
      </div>
      <div className="stage"><canvas ref={canvas} /></div>
    </div>
  );
}
