"""Smoke test: python test_report.py"""

from report import Params, analyze_report, build_report


def demo() -> None:
    a = analyze_report(build_report(Params(seed=3, regions=4, appendix_rows=120)))
    heads = [h["text"] for h in a["outline"] if h["level"] == 1]
    assert heads[0] == "Contents" and "1. Executive summary" in heads and "Appendix A. Customer ledger" in heads, heads
    assert any(h["level"] == 2 for h in a["outline"]), "has sub-headings"
    assert a["pictures"] == 2, a["pictures"]
    assert [s["orientation"] for s in a["sections"]] == ["portrait", "landscape"], a["sections"]  # landscape appendix
    ledger = max(a["tables"], key=lambda t: t["rows"])
    assert ledger["rows"] == 1 + 120 + 1 and ledger["cols"] == 7, ledger  # header + rows + total
    assert a["footer_has_page_numbers"] and "Annual Report" in a["header"]
    assert a["lists"]["bullets"] == 3 and a["lists"]["numbered"] == 5, a["lists"]
    assert a["words"] > 400, a["words"]

    # deterministic for a seed, different for another; fewer regions / no appendix / no charts change the shape
    assert build_report(Params(seed=3)) is not None
    small = analyze_report(build_report(Params(seed=4, regions=2, appendix_rows=0, charts=False)))
    assert small["pictures"] == 0 and len(small["tables"]) == 3 and len(small["sections"]) == 2, small
    assert analyze_report(build_report(Params(seed=3)))["tables"] == analyze_report(build_report(Params(seed=3)))["tables"]
    print("ok")


if __name__ == "__main__":
    demo()
