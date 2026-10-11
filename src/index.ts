import init, { exportDocument, loadFile, mount, onDirty, unmount } from "./wasm/wordcraft_embed.js";

export interface MountOptions {
  /** Open the built-in sample document instead of a blank one. */
  sample?: boolean;
  /** Force the WebGL2 backend (default: WebGPU where available). */
  webgl?: boolean;
  /** Where to fetch the .wasm from. Default: next to this module. */
  wasmUrl?: string | URL;
}

export interface WordCraftEditor {
  /** Open a document. Format comes from the name's extension (docx, odt, rtf, html, md, txt...). */
  load(file: Blob | Uint8Array, name?: string): Promise<void>;
  /** Serialize the document. `format` = docx (default), odt, rtf, html, md, txt. */
  export(format?: string): Promise<Uint8Array>;
  /** Same as `export`, as a Blob ready for download/upload. */
  exportBlob(format?: string): Promise<Blob>;
  /** Fires with true/false when the unsaved-changes flag flips. Returns an unsubscribe fn. */
  onDirty(cb: (dirty: boolean) => void): () => void;
  /** Stop this editor and free its canvas. Unsaved changes are lost. */
  destroy(): void;
}

const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
  html: "text/html",
  md: "text/markdown",
  txt: "text/plain",
};

let ready: Promise<unknown> | undefined;

/** Mount an editor into a <canvas>. Call it once per canvas; any number can share a page. Browser only. */
export async function mountEditor(canvas: HTMLCanvasElement, opts: MountOptions = {}): Promise<WordCraftEditor> {
  ready ??= init(opts.wasmUrl ? { module_or_path: opts.wasmUrl } : undefined);
  await ready;
  const id = await mount(canvas, !!opts.sample, !!opts.webgl);
  const exp = (format = "docx") => exportDocument(id, `document.${format}`) as Promise<Uint8Array>;
  return {
    async load(file, name = "document.docx") {
      const bytes = file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
      if (file instanceof File) name = file.name;
      loadFile(id, name, bytes);
    },
    export: exp,
    async exportBlob(format = "docx") {
      return new Blob([(await exp(format)) as BlobPart], { type: MIME[format] ?? "application/octet-stream" });
    },
    onDirty(cb) {
      onDirty(id, cb);
      return () => onDirty(id, null);
    },
    destroy: () => unmount(id),
  };
}
