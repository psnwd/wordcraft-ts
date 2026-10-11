"use client";

import { useEffect, useRef, useState } from "react";
import { mountEditor, type WordCraftEditor } from "wordcraft-ts";

export interface DocPaneProps {
  id: string;
  active: boolean;
  sample?: boolean;
  /** A file to open right after the editor starts. */
  file?: File;
  onReady: (id: string, editor: WordCraftEditor) => void;
  onDirty: (id: string, dirty: boolean) => void;
  onError: (id: string, message: string) => void;
}

/** One mounted editor. Stays mounted while its tab is in the background, so state is kept. */
export default function DocPane({ id, active, sample, file, onReady, onDirty, onError }: DocPaneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  // Latest callbacks without re-running the mount effect.
  const cb = useRef({ onReady, onDirty, onError });
  cb.current = { onReady, onDirty, onError };

  useEffect(() => {
    let cancelled = false;
    let ed: WordCraftEditor | undefined;
    mountEditor(canvas.current!, { sample })
      .then(async (e) => {
        if (cancelled) return e.destroy(); // closed (or StrictMode re-ran) while loading
        ed = e;
        e.onDirty((d) => cb.current.onDirty(id, d));
        if (file) await e.load(file);
        setReady(true);
        cb.current.onReady(id, e);
      })
      .catch((e) => !cancelled && cb.current.onError(id, String(e)));
    return () => {
      cancelled = true;
      ed?.destroy();
    };
    // file/sample only matter at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className={`pane${active ? " active" : ""}`}>
      <canvas ref={canvas} />
      {!ready && <div className="loading">Loading editor…</div>}
    </div>
  );
}
