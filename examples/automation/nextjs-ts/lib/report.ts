// JSON -> .docx report engine (docx + resvg for charts), plus a sample-JSON generator.
// Same schema as the Python example: see ../REPORT_JSON.md. One big JSON document in, one big report out.
import { Resvg } from "@resvg/resvg-js";
import {
  AlignmentType, BorderStyle, Document, Footer, Header, HeadingLevel, ImageRun, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type ISectionOptions,
} from "docx";

type Block = Record<string, any> & { type: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Spec {
  title?: string; subtitle?: string; meta?: string; header?: string;
  pageNumbers?: boolean; cover?: boolean; toc?: boolean; blocks?: Block[];
}

export class SpecError extends Error {
  override name = "SpecError";
}

const BLUE = "#2F6FE0", VIOLET = "#8B5CF6", MUTED = "#6B7280", RED = "#C0392B";
const PALETTE = ["#C7D2FE", BLUE, VIOLET, "#F5A524", "#10B981", "#EF4444"];
const NUMERIC = /^[-+−]?[$€£]?[\d,]*\.?\d+%?$/;
const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED } as const;

// limits at the trust boundary: the spec is untrusted input
export const LIMITS = { blocks: 20_000, tableRows: 50_000, tableCols: 30, items: 5_000, text: 20_000, chartPoints: 500 };

// ---- validation ------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v); // eslint-disable-line @typescript-eslint/no-explicit-any
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function text(v: unknown, where: string, required = false): string {
  if (v === undefined || v === null || v === "") {
    if (required) throw new SpecError(`${where}: text is required`);
    return "";
  }
  if (typeof v !== "string" && !isNum(v)) throw new SpecError(`${where}: expected a string`);
  const s = String(v);
  if (s.length > LIMITS.text) throw new SpecError(`${where}: text longer than ${LIMITS.text} characters`);
  return s;
}

function hex(v: unknown, where: string, fallback: string): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== "string" || !/^#?[0-9a-fA-F]{6}$/.test(v)) throw new SpecError(`${where}: colours look like #RRGGBB`);
  return "#" + v.replace(/^#/, "");
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v).slice(0, LIMITS.text);
}

export function validate(spec: unknown): Spec {
  if (!isObj(spec)) throw new SpecError("spec must be a JSON object");
  const blocks = spec.blocks ?? [];
  if (!Array.isArray(blocks)) throw new SpecError("blocks must be a list");
  if (blocks.length > LIMITS.blocks) throw new SpecError(`too many blocks (${blocks.length} > ${LIMITS.blocks})`);
  blocks.forEach((b, i) => {
    const w = `blocks[${i}]`;
    if (!isObj(b) || !("type" in b)) throw new SpecError(`${w}: needs a "type"`);
    switch (b.type) {
      case "heading":
        if (![undefined, 1, 2, 3].includes(b.level)) throw new SpecError(`${w}: heading level must be 1, 2 or 3`);
        text(b.text, w, true);
        break;
      case "paragraph":
      case "quote":
        text(b.text, w, true);
        if (b.align !== undefined && b.align !== null && !(b.align in ALIGN)) throw new SpecError(`${w}: align must be one of ${Object.keys(ALIGN).join(", ")}`);
        break;
      case "bullets":
      case "numbered":
        if (!Array.isArray(b.items) || b.items.length > LIMITS.items) throw new SpecError(`${w}: items must be a list of at most ${LIMITS.items}`);
        b.items.forEach((it: unknown, j: number) => text(it, `${w}.items[${j}]`, true));
        break;
      case "table":
        if (!Array.isArray(b.columns) || !b.columns.length || b.columns.length > LIMITS.tableCols) throw new SpecError(`${w}: columns must be a non-empty list of at most ${LIMITS.tableCols}`);
        if (!Array.isArray(b.rows) || b.rows.length > LIMITS.tableRows) throw new SpecError(`${w}: rows must be a list of at most ${LIMITS.tableRows}`);
        b.rows.forEach((r: unknown, j: number) => {
          if (!Array.isArray(r) || r.length > b.columns.length) throw new SpecError(`${w}.rows[${j}]: a row is a list with at most ${b.columns.length} cells`);
        });
        if (b.total != null && !Array.isArray(b.total)) throw new SpecError(`${w}: total must be a list of cells`);
        if (b.align != null && (!Array.isArray(b.align) || b.align.some((a: unknown) => !["left", "right", "center"].includes(a as string)))) throw new SpecError(`${w}: align must be a list of left/right/center`);
        break;
      case "chart": {
        if (b.kind !== "bar" && b.kind !== "line") throw new SpecError(`${w}: chart kind must be "bar" or "line"`);
        if (!Array.isArray(b.labels) || b.labels.length < 1 || b.labels.length > LIMITS.chartPoints) throw new SpecError(`${w}: labels must be a list of 1..${LIMITS.chartPoints}`);
        if (!Array.isArray(b.series) || b.series.length < 1 || b.series.length > 6) throw new SpecError(`${w}: series must be a list of 1..6`);
        b.series.forEach((s: unknown, j: number) => {
          const v = isObj(s) ? s.values : undefined;
          if (!Array.isArray(v) || v.length !== b.labels.length || !v.every(isNum)) throw new SpecError(`${w}.series[${j}]: values must be ${b.labels.length} numbers`);
          hex((s as Record<string, unknown>).color, `${w}.series[${j}].color`, BLUE);
        });
        break;
      }
      case "image":
        if (typeof b.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data) || b.data.length % 4 !== 0) throw new SpecError(`${w}: data must be base64 PNG/JPEG bytes`);
        if (!imageSize(Buffer.from(b.data, "base64"))) throw new SpecError(`${w}: data must be a PNG or JPEG image`);
        break;
      case "section":
        if (b.orientation !== "portrait" && b.orientation !== "landscape") throw new SpecError(`${w}: orientation must be "portrait" or "landscape"`);
        break;
      case "pageBreak":
        break;
      default:
        throw new SpecError(`${w}: unknown block type "${b.type}"`);
    }
  });
  return spec as Spec;
}

// ---- rendering helpers -----------------------------------------------------------------------------------

/** PNG or JPEG pixel size from the header bytes (no image library needed). */
function imageSize(b: Uint8Array): { width: number; height: number; type: "png" | "jpg" } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length > 24 && v.getUint32(0) === 0x89504e47) return { width: v.getUint32(16), height: v.getUint32(20), type: "png" };
  if (b.length > 4 && v.getUint16(0) === 0xffd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: v.getUint16(i + 5), width: v.getUint16(i + 7), type: "jpg" };
      i += 2 + v.getUint16(i + 2);
    }
  }
  return null;
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const noHash = (c: string) => c.replace("#", "");
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  const f = v / e;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
}

/** A bar or line chart as SVG text, drawn without any chart library. */
function chartSvg(b: Block): { svg: string; width: number; height: number } {
  const W = 1120, H = 512;
  const labels: string[] = b.labels.map(String);
  const series: { name?: string; color?: string; values: number[] }[] = b.series;
  const all = series.flatMap((s) => s.values);
  const ymax = niceMax(Math.max(0, ...all));
  const ymin = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
  const L = 120, R = 30, T = b.title ? 64 : 44, B = 76;
  const pw = W - L - R, ph = H - T - B;
  const y = (v: number) => T + ph - ((v - ymin) / (ymax - ymin)) * ph;
  const gx = (i: number) => L + (pw / labels.length) * (i + 0.5);
  const parts: string[] = [`<rect width="${W}" height="${H}" fill="#fff"/>`];
  for (let t = 0; t <= 5; t++) {
    const v = ymin + ((ymax - ymin) / 5) * t, yy = y(v);
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" stroke="#000" stroke-opacity="${t === 0 ? 0.6 : 0.12}"/>`);
    parts.push(`<text x="${L - 10}" y="${yy + 5}" font-size="22" text-anchor="end" fill="#333">${xml(Math.round(v).toLocaleString("en-US"))}</text>`);
  }
  const step = Math.max(1, Math.ceil(labels.length / 12));
  labels.forEach((l, i) => i % step === 0 && parts.push(`<text x="${gx(i)}" y="${H - B + 32}" font-size="22" text-anchor="middle" fill="#333">${xml(l)}</text>`));
  const n = series.length;
  series.forEach((s, k) => {
    const color = hex(s.color, "chart.color", n > 1 ? PALETTE[(k + 1) % PALETTE.length] : BLUE);
    if (b.kind === "bar") {
      const slot = (pw / labels.length) * 0.8, bw = slot / n;
      s.values.forEach((v, i) => {
        const x = gx(i) - slot / 2 + k * bw, y0 = y(0), y1 = y(v);
        parts.push(`<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.abs(y0 - y1)}" fill="${color}"/>`);
      });
    } else {
      const pts = s.values.map((v, i) => `${gx(i)},${y(v)}`).join(" ");
      if (n === 1) parts.push(`<polygon points="${gx(0)},${y(0)} ${pts} ${gx(labels.length - 1)},${y(0)}" fill="${color}" fill-opacity="0.12"/>`);
      parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="4" stroke-linejoin="round"/>`);
      if (labels.length <= 24) s.values.forEach((v, i) => parts.push(`<circle cx="${gx(i)}" cy="${y(v)}" r="6" fill="${color}"/>`));
    }
  });
  let lx = W - R;
  [...series].reverse().forEach((s, ri) => {
    if (!s.name) return;
    const k = n - 1 - ri, color = hex(s.color, "chart.color", n > 1 ? PALETTE[(k + 1) % PALETTE.length] : BLUE);
    const w = s.name.length * 12 + 44;
    lx -= w;
    parts.push(`<rect x="${lx}" y="${T - 28}" width="20" height="20" fill="${color}"/><text x="${lx + 28}" y="${T - 10}" font-size="22" fill="#333">${xml(s.name)}</text>`);
  });
  if (b.yLabel) parts.push(`<text transform="translate(32 ${T + ph / 2}) rotate(-90)" font-size="22" text-anchor="middle" fill="#333">${xml(String(b.yLabel))}</text>`);
  if (b.title) parts.push(`<text x="${W / 2}" y="26" font-size="26" font-weight="bold" text-anchor="middle" fill="#222">${xml(String(b.title))}</text>`);
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif">${parts.join("")}</svg>`, width: W, height: H };
}

function chartPng(b: Block): { png: Uint8Array; width: number; height: number } {
  const { svg, width, height } = chartSvg(b);
  return { png: new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng(), width, height };
}

const line = { style: BorderStyle.SINGLE, size: 4, color: "808080" };
const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };

function tableCell(t: string, o: { bold?: boolean; align?: string; fill?: string; color?: string; width?: number } = {}) {
  return new TableCell({
    width: o.width ? { size: o.width, type: WidthType.DXA } : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, fill: noHash(o.fill), color: "auto" } : undefined,
    margins: { top: 20, bottom: 20, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: o.align === "right" ? AlignmentType.RIGHT : o.align === "center" ? AlignmentType.CENTER : undefined,
      spacing: { after: 0 },
      children: [new TextRun({ text: t, bold: o.bold, size: 20, color: o.color ? noHash(o.color) : undefined })],
    })],
  });
}

/** `pageWidth` is the usable width in twips (portrait 9360, landscape 12960). */
function buildTable(b: Block, pageWidth: number): Table {
  const cols: string[] = b.columns.map(String);
  const rows: string[][] = b.rows.map((r: unknown[]) => [...r.map(cellText), ...Array(cols.length - r.length).fill("")]);
  const align: string[] = [...(b.align ?? cols.map((_, i) => (rows.length && NUMERIC.test(rows[0][i].trim() || "x") ? "right" : "left")))];
  while (align.length < cols.length) align.push("left");
  const highlight: Record<string, string> = Object.fromEntries(Object.entries(b.highlight ?? {}).map(([k, v]) => [k, hex(v, "table.highlight", RED)]));
  const zebra = b.zebra !== false, negatives = b.colourNegatives !== false;
  // column widths follow the longest cell, so "North America" does not wrap while "Q1" gets no extra room
  const weight = cols.map((c, i) => Math.min(40, Math.max(5, c.length, ...rows.map((r) => r[i].length))) + 3);
  const widths = weight.map((w) => Math.floor((w / sum(weight)) * pageWidth));
  const trs = [new TableRow({ tableHeader: b.headerRepeat !== false, cantSplit: true, children: cols.map((c, i) => tableCell(c, { bold: true, align: align[i], fill: "#D9E2F3", width: widths[i] })) })];
  rows.forEach((r, n) =>
    trs.push(new TableRow({
      cantSplit: true, // keep a row on one page
      children: r.map((v, i) => tableCell(v, {
        align: align[i], fill: zebra && n % 2 ? "#F5F7FB" : undefined, width: widths[i],
        color: highlight[v] ?? (negatives && align[i] === "right" && /^[-−]/.test(v) ? RED : undefined),
      })),
    })),
  );
  if (b.total) {
    const total: string[] = [...b.total.map(cellText), ...Array(Math.max(0, cols.length - b.total.length)).fill("")];
    trs.push(new TableRow({ cantSplit: true, children: total.slice(0, cols.length).map((v: string, i: number) => tableCell(v, { bold: true, align: align[i], fill: "#E8EEF9", width: widths[i] })) }));
  }
  return new Table({ rows: trs, width: { size: pageWidth, type: WidthType.DXA }, columnWidths: widths, borders, alignment: AlignmentType.CENTER });
}

const caption = (t: string) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, italics: true })] });
const picture = (data: Uint8Array, type: "png" | "jpg", width: number, height: number, widthIn: number) =>
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type, data, transformation: { width: widthIn * 96, height: (widthIn * 96 * height) / width } })] });

// ---- the document ----------------------------------------------------------------------------------------

export async function renderSpec(raw: unknown): Promise<Uint8Array> {
  const spec = validate(raw);
  const blocks = spec.blocks ?? [];
  const cover = spec.cover !== false && !!spec.title;
  const heading = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

  const sections: ISectionOptions[] = [];
  let children: (Paragraph | Table)[] = [];
  let landscape = false;
  let numbered = 0; // each numbered list restarts at 1
  const furniture = (): Partial<ISectionOptions> => {
    const headers = spec.header ? new Header({ children: [new Paragraph({ children: [new TextRun({ text: text(spec.header, "header"), size: 18, color: noHash(MUTED) })] })] }) : new Header({ children: [new Paragraph("")] });
    const footers = spec.pageNumbers !== false
      ? new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] })] })] })
      : new Footer({ children: [new Paragraph("")] });
    return { headers: { default: headers, first: new Header({ children: [new Paragraph("")] }) }, footers: { default: footers, first: new Footer({ children: [new Paragraph("")] }) } };
  };
  const flush = () => {
    sections.push({
      properties: { page: { size: { orientation: landscape ? "landscape" : "portrait" } as never }, titlePage: sections.length === 0 && cover },
      ...(sections.length === 0 ? furniture() : {}), // later sections inherit the header and footer
      children,
    });
    children = [];
  };

  if (cover) {
    children.push(new Paragraph({ text: text(spec.title, "title"), style: "Title", spacing: { before: 3400 } }));
    if (spec.subtitle) children.push(new Paragraph({ text: text(spec.subtitle, "subtitle"), style: "Subtitle" }));
    if (spec.meta) children.push(new Paragraph({ children: [new TextRun({ text: text(spec.meta, "meta"), color: noHash(MUTED) })] }));
    children.push(pageBreak());
  }
  if (spec.toc !== false) {
    const h1 = blocks.filter((b) => b.type === "heading" && (b.level ?? 1) === 1).map((b) => String(b.text));
    if (h1.length) { // a static list: page numbers would need Word to lay the document out
      children.push(new Paragraph({ text: "Contents", heading: HeadingLevel.HEADING_1 }));
      h1.forEach((h) => children.push(new Paragraph({ text: h })));
      children.push(pageBreak());
    }
  }

  for (const b of blocks) {
    switch (b.type) {
      case "heading":
        children.push(new Paragraph({ text: String(b.text), heading: heading[b.level ?? 1] }));
        break;
      case "paragraph":
        children.push(new Paragraph({ alignment: b.align ? ALIGN[b.align as keyof typeof ALIGN] : undefined, children: [new TextRun({ text: String(b.text), bold: !!b.bold, italics: !!b.italic })] }));
        break;
      case "quote":
        children.push(new Paragraph({ text: String(b.text), style: "Quote", spacing: { before: 240 } }));
        break;
      case "bullets":
        b.items.forEach((it: unknown) => children.push(new Paragraph({ text: String(it), numbering: { reference: "bullets", level: 0 } })));
        break;
      case "numbered": {
        const instance = ++numbered;
        b.items.forEach((it: unknown) => children.push(new Paragraph({ text: String(it), numbering: { reference: "numbers", level: 0, instance } })));
        break;
      }
      case "table":
        children.push(buildTable(b, landscape ? 12960 : 9360));
        children.push(b.caption ? caption(String(b.caption)) : new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: "", size: 12 })] })); // a gap after the table
        break;
      case "chart": {
        const { png, width, height } = chartPng(b);
        children.push(picture(png, "png", width, height, Number(b.width_in ?? 6)));
        if (b.caption) children.push(caption(String(b.caption)));
        break;
      }
      case "image": {
        const data = Buffer.from(b.data, "base64");
        const size = imageSize(data)!;
        children.push(picture(data, size.type, size.width, size.height, Number(b.width_in ?? 5)));
        if (b.caption) children.push(caption(String(b.caption)));
        break;
      }
      case "pageBreak":
        children.push(pageBreak());
        break;
      case "section":
        flush();
        landscape = b.orientation === "landscape";
        break;
    }
  }
  flush();

  const para = (id: string, name: string, size: number, color: string, extra: object = {}) => ({
    id, name, basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Calibri", size, bold: true, color }, paragraph: { spacing: { before: 280, after: 120 }, keepNext: true, ...extra },
  });
  const doc = new Document({
    creator: "wordcraft-ts",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        para("Heading1", "Heading 1", 40, noHash(BLUE)), para("Heading2", "Heading 2", 30, noHash(BLUE)), para("Heading3", "Heading 3", 24, noHash(BLUE)),
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Calibri", size: 64, color: "1F2937" } },
        { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Calibri", size: 32, italics: true, color: noHash(BLUE) } },
        { id: "Quote", name: "Quote", basedOn: "Normal", next: "Normal", quickFormat: true, run: { italics: true, color: "4B5563" }, paragraph: { indent: { left: 720, right: 720 } } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      ],
    },
    sections,
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ---- sample spec -----------------------------------------------------------------------------------------

const ALL_REGIONS = ["North America", "EMEA", "APAC", "Latin America", "Middle East", "Africa"];
const PRODUCTS = ["Studio", "Cloud Sync", "Review Suite", "Mobile", "API"];
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"];
const NAME_A = ["Alder", "Birch", "Cedar", "Delta", "Ember", "Fjord", "Granite", "Harbor", "Iris", "Juniper", "Kestrel", "Lumen"];
const NAME_B = ["Press", "Labs", "Works", "Studio", "Group", "Systems", "Co-op", "Media", "Partners", "Holdings"];
const PLANS = ["Starter", "Team", "Business", "Enterprise"];
const STATUSES = ["Active", "Active", "Active", "Trial", "Churned"];

export interface Params { company: string; year: number; seed: number; regions: number; appendix_rows: number; charts: boolean }

export function cleanParams(p: Partial<Params>): Params {
  const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
  return {
    company: String(p.company ?? "").trim().slice(0, 80) || "Company",
    year: Math.max(1990, Math.min(2100, int(p.year, 2025))),
    seed: int(p.seed, 7),
    regions: Math.max(2, Math.min(ALL_REGIONS.length, int(p.regions, 4))),
    appendix_rows: Math.max(0, Math.min(LIMITS.tableRows, int(p.appendix_rows, 80))),
    charts: p.charts !== false,
  };
}

/** Seeded random numbers (mulberry32), so a seed always gives the same report. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const uniform = (lo: number, hi: number) => lo + (hi - lo) * next();
  const gauss = (mu: number, sigma: number) => mu + sigma * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)];
  return { uniform, gauss, int, pick };
}

const pct = (n: number, o: number) => (o ? (n - o) / o : 0);
const money = (v: number) => Math.round(v).toLocaleString("en-US");
const sgn = (v: number, d = 1) => `${v >= 0 ? "+" : "-"}${(Math.abs(v) * 100).toFixed(d)}%`;
const share = (v: number) => `${Math.round(v * 100)}%`;

/** A realistic big report as JSON. Numbers are synthetic and deterministic per seed; the text is computed. */
export function makeSpec(input: Partial<Params>): Spec {
  const p = cleanParams(input);
  const r = rng(p.seed);
  const regions = ALL_REGIONS.slice(0, p.regions);
  const prev: Record<string, number[]> = {}, cur: Record<string, number[]> = {};
  for (const reg of regions) {
    const base = r.uniform(700, 2600), g = r.gauss(0.1, 0.08);
    prev[reg] = [0, 1, 2, 3].map((i) => base * r.uniform(0.9, 1.1) * (1 + 0.02 * i));
    cur[reg] = prev[reg].map((v) => v * (1 + g + r.gauss(0, 0.03)));
  }
  const prod: Record<string, [number, number, number]> = {};
  for (const n of PRODUCTS) {
    const base = r.uniform(1500, 6000);
    prod[n] = [base, base * (1 + r.gauss(0.09, 0.12)), r.uniform(0.55, 0.85)];
  }
  const customers = Array.from({ length: p.appendix_rows }, (_, i) => ({
    id: `C-${1000 + i}`, name: `${r.pick(NAME_A)} ${r.pick(NAME_B)}`, region: r.pick(regions), plan: r.pick(PLANS),
    seats: r.int(3, 900), mrr: Math.round(r.uniform(90, 14000) * 100) / 100, status: r.pick(STATUSES),
  }));

  const tp = Object.fromEntries(regions.map((g) => [g, sum(prev[g])])), tc = Object.fromEntries(regions.map((g) => [g, sum(cur[g])]));
  const revP = sum(Object.values(tp)), revC = sum(Object.values(tc)), growth = pct(revC, revP);
  const ranked = [...regions].sort((a, b) => pct(tc[b], tp[b]) - pct(tc[a], tp[a]));
  const top = ranked[0], weak = ranked[ranked.length - 1];
  const qTot = [0, 1, 2, 3].map((i) => sum(regions.map((g) => cur[g][i])));
  const bestQ = QUARTERS[qTot.indexOf(Math.max(...qTot))];
  const biggest = regions.reduce((a, b) => (tc[b] > tc[a] ? b : a));
  const bigShare = tc[biggest] / revC;
  const prodNew = sum(Object.values(prod).map((x) => x[1]));
  const gm = sum(Object.values(prod).map(([, c, m]) => c * m)) / prodNew;
  const chg = (n: string) => pct(prod[n][1], prod[n][0]);
  const bestP = PRODUCTS.reduce((a, b) => (chg(b) > chg(a) ? b : a)), worstP = PRODUCTS.reduce((a, b) => (chg(b) < chg(a) ? b : a));
  const active = customers.filter((c) => c.status === "Active");

  const blocks: Block[] = [
    { type: "heading", level: 1, text: "1. Executive summary" },
    { type: "paragraph", text: `${p.company} closed ${p.year} with revenue of $${money(revC)}k, ${growth >= 0 ? "up" : "down"} ${(Math.abs(growth) * 100).toFixed(1)}% on $${money(revP)}k the year before. ${top} grew fastest (${sgn(pct(tc[top], tp[top]))}), while ${weak} moved at ${sgn(pct(tc[weak], tp[weak]))}. The strongest quarter was ${bestQ}.` },
    { type: "table", columns: ["Key figure", "Value"], align: ["left", "right"], rows: [
      ["Revenue ($k)", money(revC)], ["Year-over-year growth", sgn(growth)], ["Blended gross margin", `${(gm * 100).toFixed(1)}%`],
      ["Largest region", `${biggest} (${share(bigShare)} of revenue)`],
      ["Customers in the ledger", customers.length ? `${customers.length} (${active.length} active)` : "n/a"]] },
    { type: "quote", text: `“Growth came from ${top}, not from price: volumes carried the year.”` },
    { type: "heading", level: 1, text: "2. Revenue analysis" },
    { type: "heading", level: 2, text: "2.1 Revenue by region and quarter" },
    { type: "paragraph", text: "All figures are in thousands of US dollars. Negative changes are shown in red." },
    { type: "table", columns: ["Region", ...QUARTERS, "Total", "YoY"], rows: regions.map((g) => [g, ...cur[g].map(money), money(tc[g]), sgn(pct(tc[g], tp[g]))]),
      total: ["Total", ...qTot.map(money), money(revC), sgn(growth)] },
  ];
  if (p.charts) {
    blocks.push(
      { type: "heading", level: 2, text: "2.2 Charts" },
      { type: "chart", kind: "bar", labels: regions, yLabel: "$k", caption: `Figure 1. Revenue by region, ${p.year - 1} vs ${p.year}.`,
        series: [{ name: String(p.year - 1), color: "#C7D2FE", values: regions.map((g) => Math.round(tp[g])) }, { name: String(p.year), color: BLUE, values: regions.map((g) => Math.round(tc[g])) }] },
      { type: "chart", kind: "line", labels: QUARTERS, yLabel: "$k", caption: `Figure 2. Total revenue by quarter. ${bestQ} was the peak.`, series: [{ name: "", color: VIOLET, values: qTot.map(Math.round) }] },
    );
  }
  blocks.push(
    { type: "heading", level: 2, text: "2.3 What moved" },
    { type: "bullets", items: ranked.slice(0, 3).map((g) => `${g}: ${sgn(pct(tc[g], tp[g]))} to $${money(tc[g])}k.`) },
    { type: "heading", level: 2, text: "2.4 Regional commentary" },
  );
  for (const g of regions) {
    const qs = cur[g], vs = pct(tc[g], tp[g]) - growth;
    blocks.push({ type: "heading", level: 3, text: g }, { type: "paragraph", text:
      `${g} delivered $${money(tc[g])}k, ${sgn(pct(tc[g], tp[g]))} year over year and ${share(tc[g] / revC)} of group revenue. Its best quarter was ${QUARTERS[qs.indexOf(Math.max(...qs))]} ($${money(Math.max(...qs))}k) and its weakest ${QUARTERS[qs.indexOf(Math.min(...qs))]} ($${money(Math.min(...qs))}k), a spread of ${share((Math.max(...qs) - Math.min(...qs)) / Math.max(...qs))}. That is ${(Math.abs(vs) * 100).toFixed(1)}% points ${vs >= 0 ? "ahead of" : "behind"} the group, ${vs >= 0 ? "so it is a candidate for more investment" : "so we are reviewing the plan for next year"}.` });
  }
  const prodOld = sum(Object.values(prod).map((x) => x[0]));
  blocks.push(
    { type: "heading", level: 1, text: "3. Product performance" },
    { type: "table", columns: ["Product", `${p.year - 1} ($k)`, `${p.year} ($k)`, "Change", "Gross margin"],
      rows: PRODUCTS.map((n) => [n, money(prod[n][0]), money(prod[n][1]), sgn(chg(n)), share(prod[n][2])]),
      total: ["All products", money(prodOld), money(prodNew), sgn(pct(prodNew, prodOld)), share(gm)] },
    { type: "paragraph", text: `${bestP} was the standout (${sgn(chg(bestP))}). ${worstP} needs attention (${sgn(chg(worstP))}).` },
    { type: "heading", level: 2, text: "3.1 Product notes" },
  );
  for (const n of PRODUCTS) {
    const [a, b, m] = prod[n];
    const verdict = b < a
      ? (m >= gm ? "Revenue fell, and it is a high-margin line, so the loss hurts profit." : "Revenue fell on a below-average margin, so the profit impact is limited.")
      : (m >= gm ? "Margin is above the blended average, so growth here is welcome." : "Margin is below the blended average, so growth here dilutes profit.");
    blocks.push({ type: "heading", level: 3, text: n }, { type: "paragraph", text: `${n} earned $${money(b)}k (${sgn(pct(b, a))}) at a ${share(m)} gross margin, contributing ${share(b / prodNew)} of product revenue. ${verdict}` });
  }
  const target = revC * (1 + Math.max(0.04, growth * 0.9));
  blocks.push(
    { type: "heading", level: 1, text: "4. Risks and mitigations" },
    { type: "paragraph", text: "The main risks, in the order we would address them:" },
    { type: "numbered", items: [
      `Concentration. ${biggest} is ${share(bigShare)} of revenue; a slowdown there moves the whole result.`,
      `Weak region. ${weak} grew ${sgn(pct(tc[weak], tp[weak]))}; review pricing and partners.`,
      `Product drag. ${worstP} shrank relative to the others; decide whether to invest or sunset.`,
      customers.length ? "Churn. Churned accounts in the ledger show where renewals are slipping." : "Churn. No ledger was included, so renewal risk is not measured here.",
      "Seasonality. Results lean on one quarter; smooth the pipeline to avoid a weak start to next year."] },
    { type: "heading", level: 1, text: "5. Outlook" },
    { type: "paragraph", text: `We plan for $${money(target)}k in ${p.year + 1} (${sgn(pct(target, revC))}), led by ${top}. Gross margin is expected to hold near ${share(gm)}.` },
    { type: "paragraph", italic: true, text: "Note: all numbers in this document are synthetic, generated from a seed for demonstration." },
    { type: "section", orientation: "landscape" },
  );
  if (customers.length) {
    blocks.push(
      { type: "heading", level: 1, text: "Appendix A. Customer ledger" },
      { type: "paragraph", text: `${customers.length.toLocaleString("en-US")} accounts. The header row repeats on every page.` },
      { type: "table", columns: ["ID", "Customer", "Region", "Plan", "Seats", "MRR ($)", "Status"], align: ["left", "left", "left", "left", "right", "right", "left"], highlight: { Churned: RED },
        rows: customers.map((c) => [c.id, c.name, c.region, c.plan, c.seats, c.mrr, c.status]),
        total: ["", "Total", "", "", sum(customers.map((c) => c.seats)), Math.round(sum(customers.map((c) => c.mrr)) * 100) / 100, ""] },
    );
  }
  blocks.push(
    { type: "heading", level: 1, text: "Appendix B. Methodology" },
    { type: "paragraph", text: "Revenue is recognised monthly and reported by quarter. Growth compares like-for-like quarters. Gross margin is revenue-weighted across products. Figures are rounded to the nearest thousand." },
  );
  return { title: p.company, subtitle: `Annual Report ${p.year}`, meta: `Regions: ${regions.join(", ")}`, header: `${p.company}  |  Annual Report ${p.year}`, pageNumbers: true, cover: true, toc: true, blocks };
}
