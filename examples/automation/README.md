# Automation examples

Examples where a program, not just a person, creates or reads documents around the embedded editor. All three do the
same thing and read the same JSON, in two modes:

- **Table from JSON**: a list of rows becomes a styled table (columns come from the data).
- **Report from JSON**: one JSON document, of any size, becomes a whole report with a cover, contents, headings, lists,
  tables, charts and a landscape appendix. Schema: [`REPORT_JSON.md`](REPORT_JSON.md). A small complete example:
  [`sample-report.json`](sample-report.json).

"Analyze" reads the edited document back out of the editor and returns its outline, tables, pictures, sections, lists
and footer fields.

| Example | Frontend | Backend |
|---|---|---|
| [`python`](python) | Vite (vanilla TS) | Python: `python-docx` and `matplotlib` behind a stdlib HTTP server. Two terminals. |
| [`nextjs-ts`](nextjs-ts) | Next.js | TypeScript route handlers: `docx`, `@resvg/resvg-js` for the charts, `fflate` and `fast-xml-parser` to read documents. No separate server. |
| [`nextjs-python`](nextjs-python) | Next.js | The same Python server, behind Next `rewrites` (one origin, no CORS). `bun run dev` starts both. |

Setup is the same as the other examples: build the package and run `bun link` in the repo root first (see the
[root README](../../README.md#examples)). The Python examples also need a virtualenv in their folder (`python -m venv .venv`,
then `pip install -r requirements.txt`).
