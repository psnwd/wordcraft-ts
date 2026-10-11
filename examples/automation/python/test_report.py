"""Smoke test: python test_report.py"""

import json
import time

from report import Params, SpecError, analyze_report, make_spec, render_spec
from server import analyze_docx


def demo() -> None:
    # the sample spec is plain JSON, and rendering it gives the full report
    spec = make_spec(Params(seed=3, regions=4, appendix_rows=120))
    spec = json.loads(json.dumps(spec))  # round-trips through JSON unchanged
    a = analyze_report(render_spec(spec))
    heads = [h["text"] for h in a["outline"] if h["level"] == 1]
    assert heads[0] == "Contents" and "1. Executive summary" in heads and "Appendix A. Customer ledger" in heads, heads
    assert any(h["level"] == 3 for h in a["outline"]), "three heading levels"
    assert a["pictures"] == 2 and a["lists"] == {"bullets": 3, "numbered": 5}, a
    assert [s["orientation"] for s in a["sections"]] == ["portrait", "landscape"], a["sections"]
    assert max(t["rows"] for t in a["table_shapes"]) == 1 + 120 + 1, a["table_shapes"]  # header + rows + total
    assert a["footer_has_page_numbers"] and "Annual Report" in a["header"]

    # a hand-written spec works too, and the options do what they say
    tiny = render_spec({"blocks": [{"type": "heading", "text": "Only"}, {"type": "table", "columns": ["a", "b"], "rows": [["x", 1], ["y", -2.5]]}], "cover": False, "toc": False, "pageNumbers": False})
    t = analyze_docx(tiny)
    assert t["tables"][0] == [["a", "b"], ["x", "1"], ["y", "-2.50"]] and not t["footer_has_page_numbers"], t

    # big JSON in, one big report out
    big = {"title": "Big", "blocks": [{"type": "heading", "text": "Ledger"}, {"type": "table", "columns": ["n", "square"], "rows": [[i, i * i] for i in range(5000)]}]}
    raw = json.dumps(big)
    t0 = time.perf_counter()
    out = render_spec(json.loads(raw))
    assert max(s["rows"] for s in analyze_report(out)["table_shapes"]) == 5001
    print(f"5000-row table from {len(raw) / 1024:.0f} KB of JSON in {time.perf_counter() - t0:.1f}s")

    # bad specs name the block that is wrong
    for bad, needle in [
        ([], "JSON object"),
        ({"blocks": [{"type": "nope"}]}, "blocks[0]: unknown block type"),
        ({"blocks": [{"type": "heading", "text": "ok"}, {"type": "table", "columns": ["a"], "rows": [[1, 2]]}]}, "blocks[1].rows[0]"),
        ({"blocks": [{"type": "chart", "kind": "pie", "labels": ["a"], "series": []}]}, "chart kind"),
        ({"blocks": [{"type": "image", "data": "!!not base64!!"}]}, "base64"),
    ]:
        try:
            render_spec(bad)
        except SpecError as e:
            assert needle in str(e), (needle, str(e))
        else:
            raise AssertionError(f"should reject {bad}")
    print("ok")


if __name__ == "__main__":
    demo()
