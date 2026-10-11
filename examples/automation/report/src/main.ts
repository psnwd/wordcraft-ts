import { mountEditor } from "wordcraft-ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const status = $("status");
const form = $<HTMLFormElement>("form");
const generateBtn = $<HTMLButtonElement>("generate");
const analyzeBtn = $<HTMLButtonElement>("analyze");
const result = $("result");

interface Analysis {
  outline: { level: number; text: string }[];
  words: number;
  paragraphs: number;
  pictures: number;
  tables: { rows: number; cols: number; header: string[] }[];
  sections: { orientation: string; width_in: number }[];
  header: string;
  footer_has_page_numbers: boolean;
  lists: { bullets: number; numbered: number };
}

function showError(message: string) {
  result.className = "err";
  result.textContent = message;
}

/** Render Python's analysis as chips plus an indented outline (textContent only: the data is untrusted). */
function showAnalysis(a: Analysis) {
  result.className = "";
  result.replaceChildren();
  const chips = document.createElement("div");
  chips.className = "chips";
  const facts = [
    `${a.words.toLocaleString()} words`,
    `${a.tables.length} tables (largest ${Math.max(0, ...a.tables.map((t) => t.rows))} rows)`,
    `${a.pictures} pictures`,
    `${a.sections.length} sections: ${a.sections.map((s) => s.orientation).join(" → ")}`,
    `${a.lists.bullets} bullets, ${a.lists.numbered} numbered`,
    a.footer_has_page_numbers ? "page numbers ✓" : "no page numbers",
  ];
  for (const f of facts) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = f;
    chips.append(chip);
  }
  const list = document.createElement("ul");
  list.className = "outline";
  for (const h of a.outline) {
    const li = document.createElement("li");
    li.className = `l${Math.min(h.level, 3)}`;
    li.textContent = h.text;
    list.append(li);
  }
  result.append(chips, list);
}

/** Call the Python server; throw its {"error"} message on failure. */
async function py(path: string, body: BodyInit, headers?: HeadersInit): Promise<Response> {
  const res = await fetch(path, { method: "POST", body, headers });
  if (!res.ok) throw new Error(await res.json().then((j) => j.error, () => res.statusText));
  return res;
}

const editor = await mountEditor($<HTMLCanvasElement>("canvas"));
status.textContent = "ready";
generateBtn.disabled = analyzeBtn.disabled = false;
editor.onDirty((d) => (status.textContent = d ? "ready · unsaved" : "ready"));

form.onsubmit = async (e) => {
  e.preventDefault();
  generateBtn.disabled = true;
  result.className = "";
  result.textContent = "Generating in Python…";
  try {
    const f = new FormData(form);
    const params = {
      company: f.get("company"),
      year: Number(f.get("year")),
      seed: Number(f.get("seed")),
      regions: Number(f.get("regions")),
      appendix_rows: Number(f.get("appendix_rows")),
      charts: f.get("charts") === "on",
    };
    const t0 = performance.now();
    const res = await py("/api/report", JSON.stringify(params), { "Content-Type": "application/json" });
    const bytes = new Uint8Array(await res.arrayBuffer());
    await editor.load(bytes, "report.docx");
    result.textContent = `Generated ${(bytes.length / 1024).toFixed(0)} KB in ${((performance.now() - t0) / 1000).toFixed(1)} s and opened it in the editor.`;
  } catch (err) {
    showError(String(err));
  } finally {
    generateBtn.disabled = false;
  }
};

analyzeBtn.onclick = async () => {
  try {
    const res = await py("/api/analyze", (await editor.export("docx")) as BodyInit);
    showAnalysis(await res.json());
  } catch (err) {
    showError(String(err));
  }
};
