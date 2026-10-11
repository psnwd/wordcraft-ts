"""Generate a long, structured annual report as .docx, and read its structure back.

build_report(params) -> bytes     numbers are synthetic and deterministic for a given seed
analyze_report(bytes) -> dict     outline, tables, pictures, sections, header/footer

Everything in the text is computed from the generated data (growth, best region, shares...), so changing the
parameters changes the narrative, the tables, the charts and the length of the document.
"""

from __future__ import annotations

import io
import random
import re
from dataclasses import dataclass

import matplotlib

matplotlib.use("Agg")  # no display needed
import matplotlib.pyplot as plt  # noqa: E402
from docx import Document  # noqa: E402
from docx.enum.section import WD_ORIENT, WD_SECTION  # noqa: E402
from docx.enum.table import WD_TABLE_ALIGNMENT  # noqa: E402
from docx.enum.text import WD_ALIGN_PARAGRAPH  # noqa: E402
from docx.oxml import OxmlElement  # noqa: E402
from docx.oxml.ns import qn  # noqa: E402
from docx.shared import Inches, Pt, RGBColor  # noqa: E402

BLUE, VIOLET, AMBER, INK, MUTED, RED = "#2F6FE0", "#8B5CF6", "#F5A524", "#14161A", "#6B7280", "#C0392B"
ALL_REGIONS = ["North America", "EMEA", "APAC", "Latin America", "Middle East", "Africa"]
PRODUCTS = ["Studio", "Cloud Sync", "Review Suite", "Mobile", "API"]
QUARTERS = ["Q1", "Q2", "Q3", "Q4"]
SECTIONS = ["Executive summary", "Revenue analysis", "Product performance", "Risks and mitigations", "Outlook"]
NAME_A = ["Alder", "Birch", "Cedar", "Delta", "Ember", "Fjord", "Granite", "Harbor", "Iris", "Juniper", "Kestrel", "Lumen"]
NAME_B = ["Press", "Labs", "Works", "Studio", "Group", "Systems", "Co-op", "Media", "Partners", "Holdings"]
PLANS = ["Starter", "Team", "Business", "Enterprise"]
STATUSES = ["Active", "Active", "Active", "Trial", "Churned"]


@dataclass
class Params:
    company: str = "Alder Street Press"
    year: int = 2025
    seed: int = 7
    regions: int = 4  # 2..6
    appendix_rows: int = 80  # 0..500
    charts: bool = True

    def clean(self) -> "Params":
        self.company = str(self.company).strip()[:80] or "Company"
        self.year = max(1990, min(2100, int(self.year)))
        self.seed = int(self.seed)
        self.regions = max(2, min(len(ALL_REGIONS), int(self.regions)))
        self.appendix_rows = max(0, min(500, int(self.appendix_rows)))
        self.charts = bool(self.charts)
        return self


# ---- data ------------------------------------------------------------------------------------------------


def make_data(p: Params) -> dict:
    rnd = random.Random(p.seed)
    regions = ALL_REGIONS[: p.regions]
    prev, cur = {}, {}
    for r in regions:
        base = rnd.uniform(700, 2600)
        growth = rnd.gauss(0.10, 0.08)
        prev[r] = [base * rnd.uniform(0.9, 1.1) * (1 + 0.02 * i) for i in range(4)]
        cur[r] = [v * (1 + growth + rnd.gauss(0, 0.03)) for v in prev[r]]
    products = {}
    for name in PRODUCTS:
        base = rnd.uniform(1500, 6000)
        products[name] = (base, base * (1 + rnd.gauss(0.09, 0.12)), rnd.uniform(0.55, 0.85))  # prev, cur, margin
    customers = []
    for i in range(p.appendix_rows):
        customers.append(
            {
                "id": f"C-{1000 + i}",
                "name": f"{rnd.choice(NAME_A)} {rnd.choice(NAME_B)}",
                "region": rnd.choice(regions),
                "plan": rnd.choice(PLANS),
                "seats": rnd.randint(3, 900),
                "mrr": round(rnd.uniform(90, 14000), 2),
                "status": rnd.choice(STATUSES),
            }
        )
    return {"regions": regions, "prev": prev, "cur": cur, "products": products, "customers": customers}


def pct(new: float, old: float) -> float:
    return (new - old) / old if old else 0.0


def money(v: float) -> str:
    return f"{v:,.0f}"


# ---- docx helpers ----------------------------------------------------------------------------------------


def shade(cell, fill: str) -> None:
    pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), fill.lstrip("#"))
    pr.append(shd)


def add_field(paragraph, instr: str, placeholder: str = "1") -> None:
    """A complex field (PAGE, NUMPAGES...) with a cached result, so it shows even before fields update."""
    for kind, text in (("begin", None), (None, instr), ("separate", None), (None, placeholder), ("end", None)):
        run = paragraph.add_run()
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        elif text == instr:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = f" {instr} "
        else:
            el = OxmlElement("w:t")
            el.text = text
        run._r.append(el)


def set_cell(cell, text: str, *, bold=False, right=False, fill: str | None = None, color: str | None = None, size=10) -> None:
    cell.text = ""
    para = cell.paragraphs[0]
    para.paragraph_format.space_after = Pt(0)
    if right:
        para.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = para.add_run(text)
    run.bold = bold
    run.font.size = Pt(size)
    if color:
        run.font.color.rgb = RGBColor.from_string(color.lstrip("#"))
    if fill:
        shade(cell, fill)


def add_table(doc, header: list[str], rows: list[list[str]], *, right_from=1, total: list[str] | None = None, colour_status=False):
    """Styled table: shaded header repeated on every page, zebra rows, red negatives, optional bold total row."""
    table = doc.add_table(rows=1, cols=len(header))
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    trpr = table.rows[0]._tr.get_or_add_trPr()
    trpr.append(OxmlElement("w:tblHeader"))  # repeat header row on each page
    for cell, h in zip(table.rows[0].cells, header):
        set_cell(cell, h, bold=True, right=header.index(h) >= right_from, fill="#D9E2F3")
    for n, row in enumerate(rows):
        cells = table.add_row().cells
        cant_split = OxmlElement("w:cantSplit")
        table.rows[-1]._tr.get_or_add_trPr().append(cant_split)
        fill = "#F5F7FB" if n % 2 else None
        for i, (cell, v) in enumerate(zip(cells, row)):
            color = RED if (v.startswith("-") and i >= right_from) else None
            if colour_status and v == "Churned":
                color = RED
            set_cell(cell, v, right=i >= right_from, fill=fill, color=color)
    if total:
        for i, (cell, v) in enumerate(zip(table.add_row().cells, total)):
            set_cell(cell, v, bold=True, right=i >= right_from, fill="#E8EEF9")
    return table


def chart_png(fig) -> io.BytesIO:
    out = io.BytesIO()
    fig.savefig(out, format="png", dpi=160, bbox_inches="tight")
    plt.close(fig)
    out.seek(0)
    return out


def style_axes(ax) -> None:
    ax.spines[["top", "right"]].set_visible(False)
    ax.grid(axis="y", alpha=0.25)
    ax.set_axisbelow(True)


def product_verdict(change: float, margin: float, blended: float) -> str:
    rich = margin >= blended
    if change < 0:
        return "Revenue fell, and it is a high-margin line, so the loss hurts profit." if rich else "Revenue fell on a below-average margin, so the profit impact is limited."
    return "Margin is above the blended average, so growth here is welcome." if rich else "Margin is below the blended average, so growth here dilutes profit."


# ---- the report ------------------------------------------------------------------------------------------


def build_report(params: Params) -> bytes:
    p = params.clean()
    d = make_data(p)
    regions, prev, cur = d["regions"], d["prev"], d["cur"]
    tot_prev = {r: sum(prev[r]) for r in regions}
    tot_cur = {r: sum(cur[r]) for r in regions}
    rev_prev, rev_cur = sum(tot_prev.values()), sum(tot_cur.values())
    growth = pct(rev_cur, rev_prev)
    by_growth = sorted(regions, key=lambda r: pct(tot_cur[r], tot_prev[r]), reverse=True)
    top, weakest = by_growth[0], by_growth[-1]
    q_tot = [sum(cur[r][i] for r in regions) for i in range(4)]
    best_q = QUARTERS[q_tot.index(max(q_tot))]
    share_top = max(tot_cur.values()) / rev_cur
    biggest = max(regions, key=lambda r: tot_cur[r])
    prod = d["products"]
    gm = sum(c * m for _, c, m in prod.values()) / sum(c for _, c, _ in prod.values())
    active = [c for c in d["customers"] if c["status"] == "Active"]

    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name, normal.font.size = "Calibri", Pt(11)
    for lvl, size in ((1, 20), (2, 15), (3, 12)):
        st = doc.styles[f"Heading {lvl}"]
        st.font.name, st.font.size = "Calibri", Pt(size)
        st.font.color.rgb = RGBColor.from_string(BLUE.lstrip("#"))
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(1)
    sec.different_first_page_header_footer = True  # no header/footer on the cover

    # running header and footer ("Page X of Y")
    hp = sec.header.paragraphs[0]
    hp.text = f"{p.company}  |  Annual Report {p.year}"
    hp.runs[0].font.size, hp.runs[0].font.color.rgb = Pt(9), RGBColor.from_string(MUTED.lstrip("#"))
    fp = sec.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    fp.add_run("Page ")
    add_field(fp, "PAGE")
    fp.add_run(" of ")
    add_field(fp, "NUMPAGES")

    # cover
    t = doc.add_paragraph(p.company, style="Title")
    t.paragraph_format.space_before = Pt(170)
    doc.add_paragraph(f"Annual Report {p.year}", style="Subtitle")
    meta = doc.add_paragraph(f"Regions: {', '.join(regions)}")
    meta.runs[0].font.color.rgb = RGBColor.from_string(MUTED.lstrip("#"))
    doc.add_page_break()

    # contents (static list: page numbers would need Word to lay the document out)
    doc.add_heading("Contents", level=1)
    for i, name in enumerate(SECTIONS, 1):
        doc.add_paragraph(f"{i}.  {name}")
    doc.add_paragraph("A.  Appendix: customer ledger" if p.appendix_rows else "A.  Appendix: methodology")
    doc.add_page_break()

    # 1 executive summary
    doc.add_heading(f"1. {SECTIONS[0]}", level=1)
    doc.add_paragraph(
        f"{p.company} closed {p.year} with revenue of ${money(rev_cur)}k, "
        f"{'up' if growth >= 0 else 'down'} {abs(growth):.1%} on ${money(rev_prev)}k the year before. "
        f"{top} grew fastest ({pct(tot_cur[top], tot_prev[top]):+.1%}), while {weakest} "
        f"{'lagged' if len(regions) > 1 else 'moved'} at {pct(tot_cur[weakest], tot_prev[weakest]):+.1%}. "
        f"The strongest quarter was {best_q}."
    )
    add_table(
        doc,
        ["Key figure", "Value"],
        [
            ["Revenue ($k)", money(rev_cur)],
            ["Year-over-year growth", f"{growth:+.1%}"],
            ["Blended gross margin", f"{gm:.1%}"],
            ["Largest region", f"{biggest} ({share_top:.0%} of revenue)"],
            ["Customers in the ledger", f"{len(d['customers'])} ({len(active)} active)" if d["customers"] else "n/a"],
        ],
    )
    q = doc.add_paragraph(
        f"“Growth came from {top}, not from price: volumes carried the year.”", style="Quote"
    )
    q.paragraph_format.space_before = Pt(12)

    # 2 revenue analysis
    doc.add_heading(f"2. {SECTIONS[1]}", level=1)
    doc.add_heading("2.1 Revenue by region and quarter", level=2)
    doc.add_paragraph("All figures are in thousands of US dollars. Negative changes are shown in red.")
    rows = [[r] + [money(v) for v in cur[r]] + [money(tot_cur[r]), f"{pct(tot_cur[r], tot_prev[r]):+.1%}"] for r in regions]
    add_table(
        doc,
        ["Region", *QUARTERS, "Total", "YoY"],
        rows,
        total=["Total"] + [money(v) for v in q_tot] + [money(rev_cur), f"{growth:+.1%}"],
    )
    if p.charts:
        doc.add_heading("2.2 Charts", level=2)
        fig, ax = plt.subplots(figsize=(7, 3.2))
        xs = range(len(regions))
        ax.bar([x - 0.2 for x in xs], [tot_prev[r] for r in regions], 0.4, label=str(p.year - 1), color="#C7D2FE")
        ax.bar([x + 0.2 for x in xs], [tot_cur[r] for r in regions], 0.4, label=str(p.year), color=BLUE)
        ax.set_xticks(list(xs), regions)
        ax.set_ylabel("$k")
        ax.legend(frameon=False)
        style_axes(ax)
        doc.add_picture(chart_png(fig), width=Inches(6))
        cap = doc.add_paragraph(f"Figure 1. Revenue by region, {p.year - 1} vs {p.year}.")
        cap.alignment, cap.runs[0].italic = WD_ALIGN_PARAGRAPH.CENTER, True

        fig, ax = plt.subplots(figsize=(7, 2.8))
        ax.plot(QUARTERS, q_tot, marker="o", color=VIOLET, linewidth=2.5)
        ax.fill_between(QUARTERS, q_tot, alpha=0.12, color=VIOLET)
        ax.set_ylabel("$k")
        style_axes(ax)
        doc.add_picture(chart_png(fig), width=Inches(6))
        cap = doc.add_paragraph(f"Figure 2. Total revenue by quarter. {best_q} was the peak.")
        cap.alignment, cap.runs[0].italic = WD_ALIGN_PARAGRAPH.CENTER, True
    doc.add_heading("2.3 What moved", level=2)
    for r in by_growth[:3]:
        doc.add_paragraph(f"{r}: {pct(tot_cur[r], tot_prev[r]):+.1%} to ${money(tot_cur[r])}k.", style="List Bullet")

    doc.add_heading("2.4 Regional commentary", level=2)
    for r in regions:
        doc.add_heading(r, level=3)
        qs = cur[r]
        best, worst = QUARTERS[qs.index(max(qs))], QUARTERS[qs.index(min(qs))]
        spread = (max(qs) - min(qs)) / max(qs)
        vs_group = pct(tot_cur[r], tot_prev[r]) - growth
        doc.add_paragraph(
            f"{r} delivered ${money(tot_cur[r])}k, {pct(tot_cur[r], tot_prev[r]):+.1%} year over year and "
            f"{tot_cur[r] / rev_cur:.0%} of group revenue. Its best quarter was {best} (${money(max(qs))}k) and its "
            f"weakest {worst} (${money(min(qs))}k), a spread of {spread:.0%}. "
            f"That is {abs(vs_group):.1%} points {'ahead of' if vs_group >= 0 else 'behind'} the group, "
            f"{'so it is a candidate for more investment' if vs_group >= 0 else 'so we are reviewing the plan for next year'}."
        )

    # 3 product performance
    doc.add_heading(f"3. {SECTIONS[2]}", level=1)
    prow = [[n, money(a), money(b), f"{pct(b, a):+.1%}", f"{m:.0%}"] for n, (a, b, m) in prod.items()]
    add_table(
        doc,
        ["Product", f"{p.year - 1} ($k)", f"{p.year} ($k)", "Change", "Gross margin"],
        prow,
        total=["All products", money(sum(a for a, _, _ in prod.values())), money(sum(b for _, b, _ in prod.values())), f"{pct(sum(b for _, b, _ in prod.values()), sum(a for a, _, _ in prod.values())):+.1%}", f"{gm:.0%}"],
    )
    best_p = max(prod, key=lambda n: pct(prod[n][1], prod[n][0]))
    worst_p = min(prod, key=lambda n: pct(prod[n][1], prod[n][0]))
    doc.add_paragraph(
        f"{best_p} was the standout ({pct(prod[best_p][1], prod[best_p][0]):+.1%}). "
        f"{worst_p} needs attention ({pct(prod[worst_p][1], prod[worst_p][0]):+.1%})."
    ).paragraph_format.space_before = Pt(10)

    doc.add_heading("3.1 Product notes", level=2)
    for n, (old, new, m) in prod.items():
        doc.add_heading(n, level=3)
        doc.add_paragraph(
            f"{n} earned ${money(new)}k ({pct(new, old):+.1%}) at a {m:.0%} gross margin, "
            f"contributing {new / sum(c for _, c, _ in prod.values()):.0%} of product revenue. "
            f"{product_verdict(pct(new, old), m, gm)}"
        )

    # 4 risks
    doc.add_heading(f"4. {SECTIONS[3]}", level=1)
    doc.add_paragraph("The main risks, in the order we would address them:")
    risks = [
        f"Concentration. {biggest} is {share_top:.0%} of revenue; a slowdown there moves the whole result.",
        f"Weak region. {weakest} grew {pct(tot_cur[weakest], tot_prev[weakest]):+.1%}; review pricing and partners.",
        f"Product drag. {worst_p} shrank relative to the others; decide whether to invest or sunset.",
        "Churn. Churned accounts in the ledger show where renewals are slipping." if d["customers"] else "Churn. No ledger was included, so renewal risk is not measured here.",
        "Seasonality. Results lean on one quarter; smooth the pipeline to avoid a weak start to next year.",
    ]
    for r in risks:
        doc.add_paragraph(r, style="List Number")

    # 5 outlook
    doc.add_heading(f"5. {SECTIONS[4]}", level=1)
    target = rev_cur * (1 + max(0.04, growth * 0.9))
    doc.add_paragraph(
        f"We plan for ${money(target)}k in {p.year + 1} ({pct(target, rev_cur):+.1%}), led by {top}. "
        f"Gross margin is expected to hold near {gm:.0%}."
    )
    note = doc.add_paragraph("Note: all numbers in this document are synthetic, generated from a seed for demonstration.")
    note.runs[0].italic, note.runs[0].font.size = True, Pt(9)

    # appendix in a landscape section
    land = doc.add_section(WD_SECTION.NEW_PAGE)
    land.orientation = WD_ORIENT.LANDSCAPE
    land.page_width, land.page_height = land.page_height, land.page_width
    land.different_first_page_header_footer = False
    if d["customers"]:
        doc.add_heading("Appendix A. Customer ledger", level=1)
        doc.add_paragraph(f"{len(d['customers'])} accounts. The header row repeats on every page.")
        add_table(
            doc,
            ["ID", "Customer", "Region", "Plan", "Seats", "MRR ($)", "Status"],
            [[c["id"], c["name"], c["region"], c["plan"], str(c["seats"]), f"{c['mrr']:,.2f}", c["status"]] for c in d["customers"]],
            right_from=4,
            colour_status=True,
            total=["", "Total", "", "", str(sum(c["seats"] for c in d["customers"])), f"{sum(c['mrr'] for c in d['customers']):,.2f}", ""],
        )
    else:
        doc.add_heading("Appendix A. Methodology", level=1)
    if d["customers"]:
        doc.add_heading("Appendix B. Methodology", level=1)
    doc.add_paragraph(
        "Revenue is recognised monthly and reported by quarter. Growth compares like-for-like quarters. "
        "Gross margin is revenue-weighted across products. Figures are rounded to the nearest thousand."
    )

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# ---- reading it back -------------------------------------------------------------------------------------


def analyze_report(data: bytes) -> dict:
    doc = Document(io.BytesIO(data))
    outline = []
    for para in doc.paragraphs:
        m = re.match(r"heading\s*(\d)", para.style.name, re.I)
        if m and para.text.strip():
            outline.append({"level": int(m.group(1)), "text": para.text.strip()})
    body = [para.text for para in doc.paragraphs]
    sections = [
        {"orientation": "landscape" if s.orientation == WD_ORIENT.LANDSCAPE else "portrait", "width_in": round(s.page_width.inches, 2)}
        for s in doc.sections
    ]
    first = doc.sections[0]
    return {
        "outline": outline,
        "words": sum(len(t.split()) for t in body),
        "paragraphs": sum(1 for t in body if t.strip()),
        "pictures": len(doc.inline_shapes),
        "tables": [
            {"rows": len(t.rows), "cols": len(t.columns), "header": [c.text for c in t.rows[0].cells]} for t in doc.tables
        ],
        "sections": sections,
        "header": first.header.paragraphs[0].text if first.header.paragraphs else "",
        "footer_has_page_numbers": "PAGE" in first.footer._element.xml and "NUMPAGES" in first.footer._element.xml,
        "lists": {
            "bullets": sum(1 for para in doc.paragraphs if para.style.name.lower().startswith("list bullet")),
            "numbered": sum(1 for para in doc.paragraphs if para.style.name.lower().startswith("list number")),
        },
    }
