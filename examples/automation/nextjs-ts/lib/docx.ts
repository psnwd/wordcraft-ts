// Server-side document automation in TypeScript: build a .docx from data, read tables back out.
import { XMLParser } from "fast-xml-parser";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { strFromU8, unzipSync } from "fflate";

export interface Spec {
  title?: string;
  intro?: string;
  /** Columns come from the keys of the rows (first-seen order), so any shape of data becomes a table. */
  rows: Record<string, unknown>[];
  /** Sum numeric columns into a last row. */
  totals?: boolean;
}

export interface Analysis {
  paragraphs: number;
  words: number;
  headings: string[];
  tables: string[][][];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fmt = (v: unknown): string =>
  isNum(v) && !Number.isInteger(v) ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? "");
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const line = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };

function cell(text: string, o: { bold?: boolean; right?: boolean; fill?: string } = {}) {
  return new TableCell({
    shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : undefined, children: [new TextRun({ text, bold: o.bold })] })],
  });
}

export async function buildDocx(spec: Spec): Promise<Uint8Array> {
  const rows = spec.rows;
  if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === "object" && !Array.isArray(r))) {
    throw new Error('"rows" must be a list of objects');
  }
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);

  const children: (Paragraph | Table)[] = [new Paragraph({ text: spec.title || "Report", heading: HeadingLevel.HEADING_1 })];
  if (spec.intro) children.push(new Paragraph({ text: spec.intro }));

  if (columns.length === 0) {
    children.push(new Paragraph({ text: "(no data)" }));
  } else {
    const numeric = new Set(columns.filter((c) => rows.some((r) => isNum(r[c]))));
    const trs = [new TableRow({ tableHeader: true, children: columns.map((c) => cell(titleCase(c), { bold: true, fill: "D9E2F3" })) })];
    for (const r of rows) trs.push(new TableRow({ children: columns.map((c) => cell(fmt(r[c]), { right: numeric.has(c) })) }));
    if (spec.totals && numeric.size > 0) {
      trs.push(
        new TableRow({
          children: columns.map((c, i) => {
            if (numeric.has(c)) {
              const sum = rows.reduce((a, r) => a + (isNum(r[c]) ? r[c] : 0), 0);
              return cell(fmt(Math.round(sum * 100) / 100), { bold: true, right: true });
            }
            return cell(i === 0 ? "Total" : "", { bold: true });
          }),
        }),
      );
    }
    children.push(new Table({ rows: trs, width: { size: 100, type: WidthType.PERCENTAGE }, borders }));
  }

  return new Uint8Array(await Packer.toBuffer(new Document({ sections: [{ children }] })));
}

// ---- reading ---------------------------------------------------------------------------------

type Node = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["w:tbl", "w:tr", "w:tc", "w:p", "w:r", "w:t"].includes(name),
});

const textOf = (t: unknown): string => (typeof t === "string" ? t : ((t as Node)?.["#text"] ?? ""));
const paraText = (p: Node): string => ((p["w:r"] as Node[] | undefined) ?? []).flatMap((r) => (r["w:t"] as unknown[] | undefined) ?? []).map(textOf).join("");

export function analyzeDocx(bytes: Uint8Array): Analysis {
  const files = unzipSync(bytes, { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("not a .docx (no word/document.xml)");
  const body: Node = parser.parse(strFromU8(xml))?.["w:document"]?.["w:body"] ?? {};

  const paras: Node[] = body["w:p"] ?? [];
  const texts = paras.map(paraText);
  const tables = ((body["w:tbl"] as Node[] | undefined) ?? []).map((tbl) =>
    ((tbl["w:tr"] as Node[] | undefined) ?? []).map((tr) =>
      ((tr["w:tc"] as Node[] | undefined) ?? []).map((tc) => ((tc["w:p"] as Node[] | undefined) ?? []).map(paraText).join("\n")),
    ),
  );
  return {
    paragraphs: texts.filter((t) => t.trim()).length,
    words: texts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0),
    headings: paras.filter((p) => String(p["w:pPr"]?.["w:pStyle"]?.["@_w:val"] ?? "").startsWith("Heading")).map(paraText).filter((t) => t.trim()),
    tables,
  };
}
