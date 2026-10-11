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
  tables: string[][][]; // cell contents
  // structure (same keys as the Python example)
  outline: { level: number; text: string }[];
  pictures: number;
  table_shapes: { rows: number; cols: number; header: string[] }[];
  sections: { orientation: "portrait" | "landscape"; width_in: number }[];
  header: string;
  footer_has_page_numbers: boolean;
  lists: { bullets: number; numbered: number };
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
  isArray: (name) => ["w:tbl", "w:tr", "w:tc", "w:p", "w:r", "w:t", "w:headerReference", "w:footerReference", "w:num", "w:abstractNum", "w:lvl", "Relationship"].includes(name),
});

const textOf = (t: unknown): string => (typeof t === "string" ? t : ((t as Node)?.["#text"] ?? ""));
const paraText = (p: Node): string => ((p["w:r"] as Node[] | undefined) ?? []).flatMap((r) => (r["w:t"] as unknown[] | undefined) ?? []).map(textOf).join("");

const PARTS = /^word\/(document|numbering|header\d*|footer\d*)\.xml$|^word\/_rels\/document\.xml\.rels$/;
const attr = (n: Node | undefined, k: string): string => String(n?.[`@_${k}`] ?? "");
const textRuns = (rawXml: string) => [...rawXml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

export function analyzeDocx(bytes: Uint8Array): Analysis {
  const files = unzipSync(bytes, { filter: (f) => PARTS.test(f.name) });
  const docXml = files["word/document.xml"];
  if (!docXml) throw new Error("not a .docx (no word/document.xml)");
  const raw = strFromU8(docXml);
  const body: Node = parser.parse(raw)?.["w:document"]?.["w:body"] ?? {};
  const part = (name: string) => (files[name] ? strFromU8(files[name]) : "");

  const paras: Node[] = body["w:p"] ?? [];
  const texts = paras.map(paraText);
  const tableNodes: Node[] = body["w:tbl"] ?? [];
  const rowsOf = (tbl: Node): Node[] => tbl["w:tr"] ?? [];
  const cellsOf = (tr: Node): string[] => ((tr["w:tc"] as Node[] | undefined) ?? []).map((tc) => ((tc["w:p"] as Node[] | undefined) ?? []).map(paraText).join("\n"));
  const tables = tableNodes.map((tbl) => rowsOf(tbl).map(cellsOf));

  // outline: heading styles ("Heading1" from this example, "Heading 1" from Word and Python)
  const styleOf = (p: Node) => attr(p["w:pPr"]?.["w:pStyle"], "w:val");
  const outline = paras.flatMap((p, i) => {
    const m = /^heading\s*(\d)/i.exec(styleOf(p));
    return m && texts[i].trim() ? [{ level: Number(m[1]), text: texts[i].trim() }] : [];
  });

  // lists: by numbering format when a paragraph carries numPr, else by style name
  const numFmt = new Map<string, string>(); // numId -> format of level 0
  const nums = parser.parse(part("word/numbering.xml"))?.["w:numbering"] ?? {};
  const abstractFmt = new Map<string, string>(((nums["w:abstractNum"] as Node[] | undefined) ?? []).map((a) => [attr(a, "w:abstractNumId"), attr(a["w:lvl"]?.[0]?.["w:numFmt"], "w:val")]));
  for (const n of (nums["w:num"] as Node[] | undefined) ?? []) numFmt.set(attr(n, "w:numId"), abstractFmt.get(attr(n["w:abstractNumId"], "w:val")) ?? "");
  const lists = { bullets: 0, numbered: 0 };
  for (const p of paras) {
    const fmt = numFmt.get(attr(p["w:pPr"]?.["w:numPr"]?.["w:numId"], "w:val"));
    const style = styleOf(p);
    if (fmt !== undefined ? fmt === "bullet" : /^list\s*bullet/i.test(style)) lists.bullets++;
    else if (fmt !== undefined || /^list\s*number/i.test(style)) lists.numbered++;
  }

  // sections: a sectPr inside a paragraph ends a section; the body's own sectPr ends the last one
  const sectPrs: Node[] = [...paras.flatMap((p) => (p["w:pPr"]?.["w:sectPr"] ? [p["w:pPr"]["w:sectPr"]] : [])), ...(body["w:sectPr"] ? [body["w:sectPr"]] : [])];
  const sections = sectPrs.map((sp) => {
    const w = Number(attr(sp["w:pgSz"], "w:w")), h = Number(attr(sp["w:pgSz"], "w:h"));
    return { orientation: attr(sp["w:pgSz"], "w:orient") === "landscape" || w > h ? ("landscape" as const) : ("portrait" as const), width_in: Math.round((w / 1440) * 100) / 100 };
  });

  // header / footer of the first section: follow its references through the relationships part
  const rels = new Map<string, string>(((parser.parse(part("word/_rels/document.xml.rels"))?.Relationships?.Relationship as Node[] | undefined) ?? []).map((r) => [attr(r, "Id"), attr(r, "Target")]));
  const refPart = (kind: "header" | "footer"): string => {
    const refs: Node[] = sectPrs[0]?.[`w:${kind}Reference`] ?? [];
    const ref = refs.find((r) => attr(r, "w:type") === "default") ?? refs[0];
    const target = ref ? rels.get(attr(ref, "r:id")) : undefined;
    return target ? part(`word/${target.replace(/^\/?(word\/)?/, "")}`) : "";
  };
  const footer = refPart("footer");

  return {
    paragraphs: texts.filter((t) => t.trim()).length,
    words: texts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0),
    headings: outline.map((h) => h.text),
    tables,
    outline,
    pictures: (raw.match(/<w:drawing[ >]/g) ?? []).length,
    table_shapes: tables.map((t) => ({ rows: t.length, cols: Math.max(0, ...t.map((r) => r.length)), header: t[0] ?? [] })),
    sections,
    header: textRuns(refPart("header")),
    footer_has_page_numbers: footer.includes("PAGE") && footer.includes("NUMPAGES"),
    lists,
  };
}
