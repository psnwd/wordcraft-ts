"""Build the final logo SVGs into logos/export/.

usage: python build.py <Inter-Bold.woff>

  icon.svg       512x512, the app/favicon mark (transparent corners)
  logo.svg       1280x512 combination mark, dark text, for light backgrounds
  logo-dark.svg  1280x512 combination mark, light text, for dark backgrounds
"""

import sys
from pathlib import Path

from wordmark import text_paths

OUT = Path(__file__).resolve().parent.parent / "export"

# The mark: a rounded square (the editor), a heading bar, two lines of text and an amber text caret.
ICON = """<defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c8dff"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="104" fill="url(#g)"/>
  <rect x="104" y="140" width="200" height="56" rx="28" fill="#fff"/>
  <rect x="104" y="236" width="304" height="40" rx="20" fill="#fff" fill-opacity=".85"/>
  <rect x="104" y="310" width="212" height="40" rx="20" fill="#fff" fill-opacity=".85"/>
  <rect x="338" y="292" width="32" height="76" rx="16" fill="#ffd166"/>"""


def icon_svg() -> str:
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <g id="icon">\n  {ICON}\n  </g>\n</svg>\n'


def logo_svg(font: str, ink: str, accent: str) -> str:
    word, ext = text_paths(font, 128, 432, 304, ["wordcraft", "-ts"])
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 512">
  <title>wordcraft-ts</title>
  <g id="icon" transform="translate(64 96) scale(.625)">
  {ICON}
  </g>
  <g id="wordmark">
    <path d="{word['d']}" fill="{ink}"/>
    <path d="{ext['d']}" fill="{accent}"/>
  </g>
</svg>
"""


if __name__ == "__main__":
    font = sys.argv[1]
    OUT.mkdir(exist_ok=True)
    (OUT / "icon.svg").write_text(icon_svg(), encoding="utf-8")
    (OUT / "logo.svg").write_text(logo_svg(font, "#14161a", "#7c4ee8"), encoding="utf-8")
    (OUT / "logo-dark.svg").write_text(logo_svg(font, "#f2f4f8", "#a78bfa"), encoding="utf-8")
    print("wrote", *sorted(p.name for p in OUT.glob("*.svg")))
