<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logos/export/logo-dark.svg">
    <img alt="wordcraft-ts" src="logos/export/logo.svg" width="420">
  </picture>
</p>

<p align="center"><b>A full Word-style editor you can drop into any website, from TypeScript.</b></p>

[WordCraft](https://github.com/storytold/wordcraft) is an open-source word processor written in Rust. This
package compiles it to WebAssembly and wraps it in a small typed API: open `.docx`, edit with the ribbon,
styles, tables and track changes, then export `.docx`, `.odt`, `.rtf`, `.html`, `.md` or `.txt`. The editor runs
entirely in the browser; it sends nothing anywhere unless your code does (see the automation examples).

![Workspace with the sample document open](docs/workspace.png)

> Not published to npm yet. Build it from this repo (see [Build from source](#build-from-source)) and link it, as the
> examples do.

## Use it

```ts
import { mountEditor } from "wordcraft-ts";

const editor = await mountEditor(document.querySelector("canvas")!, { sample: false });

await editor.load(file);                  // File | Blob | Uint8Array (docx, odt, rtf, md, txt, html)
const blob = await editor.exportBlob();   // .docx; or "odt" | "rtf" | "html" | "md" | "txt"
const off = editor.onDirty((dirty) => console.log("unsaved changes:", dirty));

editor.destroy();                         // stop the editor and free its canvas
```

| API | What it does |
|---|---|
| `mountEditor(canvas, opts?)` | Starts an editor on a `<canvas>`. Options: `sample` (open the demo document), `webgl` (force WebGL2), `wasmUrl` (where to load the `.wasm` from). |
| `editor.load(file, name?)` | Opens a document. The format comes from the file name's extension. |
| `editor.export(format?)` / `exportBlob(format?)` | Returns the document as bytes / a `Blob`. Default `docx`. |
| `editor.onDirty(cb)` | Called when the unsaved-changes flag flips. Returns an unsubscribe function. |
| `editor.destroy()` | Stops this editor. Unsaved changes are lost. |

Any number of editors can share a page, one per canvas. Give each canvas a size with CSS; it resizes itself.

## Examples

### Run an example

One-time setup from the repo root builds the package and links it so the examples can import it:

```sh
bun install
bun run build     # Rust -> wasm -> dist (needs the toolchain in "Build from source")
bun link
```

Then, for any example:

```sh
cd examples/react      # any folder from the tables below
bun install
bun run dev
```

### Framework examples

Each is a small page with Open, an export-format picker, Export and an unsaved-changes indicator.

| Framework | Folder |
|---|---|
| Next.js (multi-document workspace) | [`examples/nextjs`](examples/nextjs) |
| React + Vite | [`examples/react`](examples/react) |
| Vue 3 + Vite | [`examples/vue`](examples/vue) |
| Svelte 5 + Vite | [`examples/svelte`](examples/svelte) |
| Astro (plain script, no UI framework) | [`examples/astro`](examples/astro) |

On Vite and Astro, add `optimizeDeps: { exclude: ["wordcraft-ts"] }` to the config (every example does), so the
`.wasm` URL inside the package keeps resolving. On Next.js, add `transpilePackages: ["wordcraft-ts"]`.

#### Next.js: multiple documents

[`examples/nextjs`](examples/nextjs) is a multi-document workspace: a sidebar and tab bar, one editor per
document, New / Open / Export, and unsaved-change markers.

![Two documents open in tabs, with an unsaved-changes dot on the second](docs/tabs.png)

The pattern that matters, from [`DocPane.tsx`](examples/nextjs/app/DocPane.tsx):

```tsx
"use client";

useEffect(() => {
  let cancelled = false;
  let ed: WordCraftEditor | undefined;
  mountEditor(canvas.current!).then((e) => {
    if (cancelled) return e.destroy();   // unmounted (or StrictMode re-ran) while loading
    ed = e;
  });
  return () => { cancelled = true; ed?.destroy(); };
}, []);
```

- The editor needs the browser (canvas and WASM), so load it with `dynamic(() => import("./Workspace"), { ssr: false })`
  from a client component.
- Keep background tabs mounted and hide them with `visibility: hidden` (not `display: none`), so each editor keeps
  its size and state.

### Automation examples

A program, not only a person, creates and reads the documents. All three examples do the same thing, in two modes:

1. **Generate.** *Table from JSON* turns a list of rows into a styled table. *Report from JSON* builds a whole report from
   one JSON document, which can be big (see below). The editor opens the result with `editor.load(bytes)`.
2. Edit the document in the browser.
3. **Analyze.** "Analyze" sends `editor.export("docx")` back to the backend, which returns the outline, every table, the
   pictures, sections, lists and footer fields as JSON.

| Example | Frontend | Backend | Start it |
|---|---|---|---|
| [`automation/python`](examples/automation/python) | Vite (vanilla TS) | Python: `python-docx`, `matplotlib`, stdlib HTTP server | two terminals (below) |
| [`automation/nextjs-ts`](examples/automation/nextjs-ts) | Next.js | TypeScript route handlers: `docx`, `@resvg/resvg-js` (charts), `fflate`, `fast-xml-parser` | `bun run dev` |
| [`automation/nextjs-python`](examples/automation/nextjs-python) | Next.js | The same Python server, behind Next `rewrites` | `bun run dev` (starts both) |

![Python-generated order table open in the editor, with the parsed tables on the right](docs/python.png)

**Python** (`automation/python` and `automation/nextjs-python`) needs a virtualenv inside the example folder first:

```sh
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # Linux/macOS: .venv/bin/pip
python test_server.py && python test_report.py     # self-checks (use .venv/Scripts/python or .venv/bin/python)
```

- `automation/python`: run `bun run server` (Python API on :8000) in one terminal and `bun run dev` (the page; Vite
  proxies `/api` to Python) in another.
- `automation/nextjs-python`: `bun run dev` starts Python and Next together. Next forwards `/api/*` to
  `http://127.0.0.1:8000`; change it with `PYTHON_API`. The browser only ever talks to one origin, so there is no CORS.

**TypeScript** (`automation/nextjs-ts`) has no second server: the route handlers in `app/api` (`generate`, `sample`,
`report`, `analyze`) do the work, and `bun run test` runs its self-checks.

![TypeScript automation example: a table generated by a Next.js route handler, opened in the editor](docs/nextjs-ts.png)

#### One big JSON in, one big report out

*Report from JSON* takes a single JSON document that describes a whole report: a cover, a contents list, headings
(levels 1 to 3), paragraphs, quotes, bullet and numbered lists, **tables of any size**, charts, images, page breaks and
landscape sections. The schema is in [`examples/automation/REPORT_JSON.md`](examples/automation/REPORT_JSON.md) and
[`sample-report.json`](examples/automation/sample-report.json) is a small complete example. Python and TypeScript read
the same schema, so a JSON written for one builds in the other.

- **Make the JSON your own way**, or press *Create sample JSON*: it generates a realistic annual report (synthetic numbers,
  deterministic per seed, every sentence computed from them), with an appendix of up to 50,000 rows.
- **Paste it, or load a `.json` file.** A very large JSON is kept in memory and only previewed in the text box.
- **Build.** The JSON is sent as is. A 410 KB spec with a 6,000-row table builds in about 3 s (TypeScript) or 11 s (Python)
  and opens in the editor; the table survives a round trip through WordCraft.
- **Validated before anything is built.** The spec is untrusted input, and an error names the block:
  `blocks[9000].rows[3]: a row is a list with at most 7 cells`.

What the sample report shows off: a cover without a header or footer, tables with a shaded header that repeats on every
page, zebra rows, red negatives and total rows, charts with captions, a running header, a "Page X of Y" footer (real
`PAGE` / `NUMPAGES` fields), and a landscape section for the appendix.

![Report from JSON: the JSON panel on the right, the generated report in the editor](docs/report-json.png)
![The report's charts page open in the editor](docs/report-charts.png)
![The landscape appendix: a long table with a total row and the page footer](docs/report-appendix.png)

The backends are demos: they bind to `127.0.0.1`, have no authentication, and accept up to 20 MB. Add auth and limits
before exposing anything like them.

## Things to know

- **Canvas-rendered.** The editor draws itself like a game, so it is not a DOM text box: page CSS doesn't style it,
  and text inside it isn't selectable like web text. Test mobile keyboards and IME early.
- **Size.** The `.wasm` is about 30 MB (about 12 MB gzipped). Serve it as `application/wasm` with gzip or brotli,
  and cache it.
- **Browser support.** Needs WebGPU or WebGL2. `webgl: true` forces WebGL2.
- **Browser only.** Don't call `mountEditor` during server rendering.

## Build from source

You need Rust, Bun, and the upstream repo cloned next to this one (`../wordcraft-src`, or set `WORDCRAFT_SRC`):

```sh
git clone https://github.com/storytold/wordcraft ../wordcraft-src
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked   # must match upstream's Cargo.lock
```

```sh
bun install
bun run build                    # Rust -> wasm -> src/wasm -> dist (the wasm-opt step takes ~5 min)
SKIP_OPT=1 bun run build:wasm    # faster dev build, bigger .wasm
```

The only Rust added here is [`rust/wordcraft-embed`](rust/wordcraft-embed), a thin wasm-bindgen layer
(`mount`, `unmount`, `loadFile`, `exportDocument`, `onDirty`). It reuses upstream's editor unchanged, and the
build script copies it into the upstream workspace.

## License

Same as WordCraft: MIT OR Apache-2.0. The logo is documented in [`logos/`](logos) (wordmark set in Inter, SIL OFL 1.1).
