# Automation examples

Examples where a program, not just a person, creates or reads documents around the embedded editor.

| Example | What it does |
|---|---|
| [`python`](python) | A Python server builds a `.docx` with a table made dynamically from JSON, the editor opens it, and Python reads the edited tables back as JSON. |
| [`nextjs-ts`](nextjs-ts) | The same flow in TypeScript: Next.js route handlers build the `.docx` (`docx` package) and read tables back (`fflate` + `fast-xml-parser`). No separate server. |
| [`nextjs-python`](nextjs-python) | A Next.js frontend plus the Python server. Next forwards `/api/*` to Python with `rewrites` (one origin, no CORS), and `bun run dev` starts both. |
| [`report`](report) | A long, structured **annual report** from parameters (company, year, seed, regions, appendix length): cover, contents, numbered sections with computed commentary, charts, styled tables, lists, a landscape appendix with a repeating header row, and "Page X of Y" in the footer. Python + `python-docx` + `matplotlib`. |

Setup is the same as the other examples: build the package and run `bun link` in the repo root first (see the
[root README](../../README.md#examples)).
