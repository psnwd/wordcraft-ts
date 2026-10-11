# Report JSON

One JSON document describes a whole report. Send it to `POST /api/report` (Python or the TypeScript example, same
schema) and get one `.docx` back, open it in the editor, and read its structure back with `POST /api/analyze`.
The JSON can be big: thousands of table rows, hundreds of blocks.

```jsonc
{
  "title": "Alder Street Press",        // cover page (omit, or "cover": false, for no cover)
  "subtitle": "Annual Report 2025",
  "meta": "Regions: EMEA, APAC",        // small grey line under the subtitle
  "header": "Alder Street Press | Annual Report 2025",  // running header (not on the cover)
  "pageNumbers": true,                  // "Page X of Y" footer, default true
  "cover": true,                        // default true when "title" is set
  "toc": true,                          // "Contents" page from the level-1 headings, default true
  "blocks": [ /* see below, rendered in order */ ]
}
```

## Blocks

| `type` | Fields |
|---|---|
| `heading` | `text`, `level` 1, 2 or 3 (default 1) |
| `paragraph` | `text`, optional `bold`, `italic`, `align` (`left`, `center`, `right`, `justify`) |
| `quote` | `text` |
| `bullets`, `numbered` | `items`: list of strings |
| `table` | `columns` (header labels), `rows` (lists of cells), optional `total` (a bold last row), `align` (per column: `left`, `right`, `center`; default right for numeric columns), `highlight` (`{"Churned": "#C0392B"}` colours cells with that exact text), `zebra` (default true), `colourNegatives` (default true), `headerRepeat` (default true), `caption` |
| `chart` | `kind` (`bar` or `line`), `labels`, `series` (up to 6 of `{name, values, color}`; one value per label), optional `yLabel`, `title`, `caption`, `width_in` |
| `image` | `data` (base64 PNG or JPEG), optional `width_in`, `caption` |
| `pageBreak` | none |
| `section` | `orientation`: `portrait` or `landscape`. Starts a new page with that orientation. |

Cells can be strings, numbers (integers get thousands separators, decimals two places), booleans or `null`.

## Limits

The spec is untrusted input, so it is validated before anything is built, and an error names the block:
`blocks[9000].rows[3]: a row is a list with at most 7 cells`.

| Limit | Value |
|---|---|
| blocks | 20,000 |
| rows in one table | 50,000 |
| columns in one table | 30 |
| items in one list | 5,000 |
| characters in one text | 20,000 |
| points in one chart | 500 |
| request body | 64 MB |

## Example

[`sample-report.json`](sample-report.json) is a small complete report. To get a big one, ask the sample endpoint for
many appendix rows:

```sh
curl -s localhost:8000/api/sample -d '{"appendix_rows": 5000}' > big.json     # about 1 MB
curl -s localhost:8000/api/report -d @big.json -o big.docx
```
