"use client";

import { useCallback, useRef, useState } from "react";
import type { WordCraftEditor } from "wordcraft-ts";
import DocPane from "./DocPane";

interface Doc {
  id: string;
  title: string;
  sample?: boolean;
  file?: File;
  dirty: boolean;
  ready: boolean;
}

const FORMATS = ["docx", "odt", "rtf", "html", "md", "txt"] as const;
type Format = (typeof FORMATS)[number];
let counter = 0;
const nextId = () => `doc-${++counter}`;

export default function Workspace() {
  const [docs, setDocs] = useState<Doc[]>(() => [
    { id: nextId(), title: "Handbook (sample)", sample: true, dirty: false, ready: false },
  ]);
  const [active, setActive] = useState(docs[0].id);
  const [format, setFormat] = useState<Format>("docx");
  const [toast, setToast] = useState("");
  const editors = useRef(new Map<string, WordCraftEditor>());
  const fileInput = useRef<HTMLInputElement>(null);
  const untitled = useRef(0);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }, []);
  const patch = useCallback(
    (id: string, p: Partial<Doc>) => setDocs((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d))),
    [],
  );

  const onReady = useCallback(
    (id: string, e: WordCraftEditor) => {
      editors.current.set(id, e);
      patch(id, { ready: true });
    },
    [patch],
  );
  const onDirty = useCallback((id: string, dirty: boolean) => patch(id, { dirty }), [patch]);
  const onError = useCallback((_id: string, m: string) => say(`Editor failed: ${m}`), [say]);

  function newDoc(file?: File) {
    const id = nextId();
    const title = file ? file.name : `Untitled ${++untitled.current}`;
    setDocs((ds) => [...ds, { id, title, file, dirty: false, ready: false }]);
    setActive(id);
  }

  function closeDoc(id: string) {
    const i = docs.findIndex((x) => x.id === id);
    if (docs[i]?.dirty && !window.confirm(`"${docs[i].title}" has unsaved changes. Close anyway?`)) return;
    editors.current.delete(id);
    const rest = docs.filter((x) => x.id !== id);
    setDocs(rest);
    if (active === id) setActive(rest[Math.max(0, i - 1)]?.id ?? "");
  }

  async function save() {
    const ed = editors.current.get(active);
    const doc = docs.find((d) => d.id === active);
    if (!ed || !doc) return;
    try {
      const blob = await ed.exportBlob(format);
      const base = doc.title.replace(/\.[^.]+$/, "").replace(/ \(sample\)$/, "");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${base}.${format}` });
      a.click();
      URL.revokeObjectURL(a.href);
      say(`Exported ${a.download} (${(blob.size / 1024).toFixed(1)} KB)`);
    } catch (e) {
      say(`Export failed: ${e}`);
    }
  }

  const current = docs.find((d) => d.id === active);
  const closeBtn = (id: string) => (
    <span className="x" role="button" aria-label="Close" onClick={(e) => { e.stopPropagation(); closeDoc(id); }}>×</span>
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><i /> WordCraft</div>
        <button className="btn primary" onClick={() => newDoc()}>＋ New</button>
        <button className="btn" onClick={() => fileInput.current?.click()}>Open…</button>
        <input ref={fileInput} type="file" hidden accept=".docx,.odt,.rtf,.md,.txt,.html"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) newDoc(f); e.target.value = ""; }} />
        <div className="spacer" />
        <div className="group">
          <button className="btn" disabled={!current?.ready} onClick={save}>Export</button>
          <select className="btn" value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Format">
            {FORMATS.map((f) => <option key={f} value={f}>.{f}</option>)}
          </select>
        </div>
      </div>

      <aside className="sidebar">
        <h4>Documents</h4>
        {docs.map((d) => (
          <button key={d.id} className={`doc${d.id === active ? " active" : ""}`} onClick={() => setActive(d.id)}>
            <span className="name">{d.title}</span>
            {d.dirty && <span className="dot" title="Unsaved changes" />}
            {closeBtn(d.id)}
          </button>
        ))}
      </aside>

      <main className="main">
        <div className="tabs">
          {docs.map((d) => (
            <div key={d.id} className={`tab${d.id === active ? " active" : ""}`} onClick={() => setActive(d.id)}>
              {d.title}
              {d.dirty && <span className="dot" />}
              {closeBtn(d.id)}
            </div>
          ))}
        </div>
        <div className="stage">
          {docs.map((d) => (
            <DocPane key={d.id} id={d.id} active={d.id === active} sample={d.sample} file={d.file}
              onReady={onReady} onDirty={onDirty} onError={onError} />
          ))}
          {docs.length === 0 && (
            <div className="empty">
              <div><p>No documents open.</p><button className="btn primary" onClick={() => newDoc()}>＋ New document</button></div>
            </div>
          )}
        </div>
        <div className="statusbar">
          <span>{docs.length} open</span>
          <span>{current ? (current.ready ? "ready" : "loading…") : ""}</span>
          <span>{current?.dirty ? "unsaved changes" : current ? "saved" : ""}</span>
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
