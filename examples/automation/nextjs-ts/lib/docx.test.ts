// Smoke test: bun lib/docx.test.ts
import assert from "node:assert/strict";
import { analyzeDocx, buildDocx } from "./docx";

const rows = [
  { item: "Paper", qty: 3, price: 4.5 },
  { item: "Ink", qty: 1, price: 12, note: "black" }, // extra key -> extra column
];
const out = analyzeDocx(await buildDocx({ title: "Order", rows, totals: true }));
const t = out.tables[0];
assert.deepEqual(t[0], ["Item", "Qty", "Price", "Note"]); // columns come from the data
assert.deepEqual(t[1].slice(0, 3), ["Paper", "3", "4.50"]);
assert.deepEqual(t.at(-1)?.slice(0, 3), ["Total", "4", "16.50"]); // numeric columns summed
assert.deepEqual(out.headings, ["Order"]);
assert.deepEqual(analyzeDocx(await buildDocx({ rows: [] })).tables, []); // no data, no table
await assert.rejects(buildDocx({ rows: [1, 2] as never }), /list of objects/);
assert.throws(() => analyzeDocx(new TextEncoder().encode("nope")));
console.log("ok");
