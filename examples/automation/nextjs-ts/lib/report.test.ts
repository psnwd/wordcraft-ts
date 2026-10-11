// Smoke test: bun lib/report.test.ts
import assert from "node:assert/strict";
import { analyzeDocx } from "./docx";
import { renderSpec, makeSpec, SpecError, validate } from "./report";

// the sample spec is plain JSON, and rendering it gives the full report
const spec = JSON.parse(JSON.stringify(makeSpec({ seed: 3, regions: 4, appendix_rows: 120 })));
const a = analyzeDocx(await renderSpec(spec));
const heads = a.outline.filter((h) => h.level === 1).map((h) => h.text);
assert.equal(heads[0], "Contents");
assert.ok(heads.includes("1. Executive summary") && heads.includes("Appendix A. Customer ledger"), String(heads));
assert.ok(a.outline.some((h) => h.level === 3), "three heading levels");
assert.equal(a.pictures, 2);
assert.deepEqual(a.lists, { bullets: 3, numbered: 5 });
assert.deepEqual(a.sections.map((s) => s.orientation), ["portrait", "landscape"]); // landscape appendix
assert.equal(Math.max(...a.table_shapes.map((t) => t.rows)), 1 + 120 + 1); // header + rows + total
assert.ok(a.footer_has_page_numbers && a.header.includes("Annual Report"), `${a.header}`);

// a hand-written spec works too, and the options do what they say
const tiny = analyzeDocx(await renderSpec({ cover: false, toc: false, pageNumbers: false, blocks: [{ type: "heading", text: "Only" }, { type: "table", columns: ["a", "b"], rows: [["x", 1], ["y", -2.5]] }] }));
assert.deepEqual(tiny.tables[0], [["a", "b"], ["x", "1"], ["y", "-2.50"]]);
assert.ok(!tiny.footer_has_page_numbers);

// big JSON in, one big report out
const big = JSON.stringify({ title: "Big", blocks: [{ type: "heading", text: "Ledger" }, { type: "table", columns: ["n", "square"], rows: Array.from({ length: 5000 }, (_, i) => [i, i * i]) }] });
const t0 = performance.now();
const out = analyzeDocx(await renderSpec(JSON.parse(big)));
assert.equal(Math.max(...out.table_shapes.map((t) => t.rows)), 5001);
console.log(`5000-row table from ${(big.length / 1024).toFixed(0)} KB of JSON in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

// bad specs name the block that is wrong
const bad: [unknown, string][] = [
  [[], "JSON object"],
  [{ blocks: [{ type: "nope" }] }, "blocks[0]: unknown block type"],
  [{ blocks: [{ type: "heading", text: "ok" }, { type: "table", columns: ["a"], rows: [[1, 2]] }] }, "blocks[1].rows[0]"],
  [{ blocks: [{ type: "chart", kind: "pie", labels: ["a"], series: [] }] }, "chart kind"],
  [{ blocks: [{ type: "image", data: "!!not base64!!" }] }, "base64"],
];
for (const [s, needle] of bad) {
  assert.throws(() => validate(s), (e: unknown) => e instanceof SpecError && e.message.includes(needle), needle);
}
console.log("ok");
