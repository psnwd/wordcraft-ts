"""Convert text to SVG path data (no font needed at render time).

usage: python wordmark.py <font.woff|ttf> <font-size> <x> <baseline-y> <text> [<text> ...]

Prints one JSON object per text: {"text", "d", "width"}. Each text starts where the previous one ended,
so ("wordcraft", "-ts") sit side by side. Advances only, no kerning: fine for a short lowercase word.
Logo font: Inter Bold (SIL OFL 1.1, https://rsms.me/inter).
"""

import json
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont


def text_paths(font_path: str, size: float, x: float, y: float, texts: list[str]) -> list[dict]:
    font = TTFont(font_path)
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = size / font["head"].unitsPerEm
    out = []
    for text in texts:
        pen = SVGPathPen(glyphs, ntos=lambda v: f"{v:.1f}".rstrip("0").rstrip("."))
        start = x
        for ch in text:
            name = cmap[ord(ch)]
            glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, x, y)))  # flip y: font y-up -> svg y-down
            x += glyphs[name].width * scale
        out.append({"text": text, "d": pen.getCommands(), "width": round(x - start, 1)})
    return out


if __name__ == "__main__":
    font_path, size, x, y, *texts = sys.argv[1:]
    for o in text_paths(font_path, float(size), float(x), float(y), texts):
        print(json.dumps(o))
