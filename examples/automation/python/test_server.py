"""Smoke test: python test_server.py"""

from server import analyze_docx, build_docx


def demo() -> None:
    rows = [
        {"item": "Paper", "qty": 3, "price": 4.5},
        {"item": "Ink", "qty": 1, "price": 12.0, "note": "black"},  # extra key -> extra column
    ]
    out = analyze_docx(build_docx({"title": "Order", "rows": rows, "totals": True}))
    t = out["tables"][0]
    assert t[0] == ["Item", "Qty", "Price", "Note"], t[0]  # columns come from the data
    assert t[1][:3] == ["Paper", "3", "4.50"], t[1]
    assert t[-1][0] == "Total" and t[-1][1] == "4" and t[-1][2] == "16.50", t[-1]  # numeric columns summed
    assert out["headings"] == ["Order"]
    assert analyze_docx(build_docx({"rows": []}))["tables"] == []  # no data, no table
    try:
        build_docx({"rows": [1, 2]})
    except ValueError:
        pass
    else:
        raise AssertionError("bad rows should raise")
    print("ok")


if __name__ == "__main__":
    demo()
