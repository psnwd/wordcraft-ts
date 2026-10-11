# Logo

Made with the [logo-designer](https://github.com/neonwatty/logo-designer-skill) workflow: interview, explore three
concepts, refine one, export.

| | |
|---|---|
| ![icon](export/icon.svg) | **The mark.** A rounded editor tile in WordCraft's own blue→violet gradient, with a heading bar, two lines of text and an amber text caret. It says "word processor" without copying any existing app's icon. |
| ![light logo](export/logo.svg) | **`logo.svg`** — mark + wordmark, dark text, for light backgrounds. |
| ![dark logo](export/logo-dark.svg) | **`logo-dark.svg`** — the same with light text, for dark backgrounds. |

## Files

```
logos/
├── export/                  # use these
│   ├── icon.svg             # 512x512 mark (favicons, avatars, app icons)
│   ├── logo.svg             # 1280x512 mark + wordmark, for light backgrounds
│   ├── logo-dark.svg        # 1280x512 mark + wordmark, for dark backgrounds
│   └── *-16 … 2048.png      # transparent PNGs at 16, 32, 48, 192, 512, 1024, 2048 px wide
├── concepts/                # the three directions explored (not used)
└── scripts/
    ├── build.py             # writes the SVGs
    ├── wordmark.py          # text -> SVG path outlines (no font needed to render)
    └── export.ts            # renders the PNGs
```

PNG sizes: `icon-*` are square; `logo-*` and `logo-dark-*` are 5:2 and only exist from 192 px up, because the
wordmark is unreadable smaller. Use `icon-*` for favicons.

## Use it

In a README that supports light and dark themes:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="logos/export/logo-dark.svg">
  <img alt="wordcraft-ts" src="logos/export/logo.svg" width="420">
</picture>
```

As a favicon: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">` with `icon.svg` copied to your public
folder (the examples do this).

## Rebuild

The text is converted to paths, so the SVGs render the same everywhere. Rebuilding needs
[`fonttools`](https://pypi.org/project/fonttools/) and the Inter Bold font file:

```sh
pip install fonttools
bun add -d @fontsource/inter                  # or any copy of Inter Bold as .woff/.ttf
python logos/scripts/build.py node_modules/@fontsource/inter/files/inter-latin-700-normal.woff
bun run logo:export                           # PNGs (uses @resvg/resvg-js)
```

## Credits and license

- The wordmark is set in **Inter Bold** by Rasmus Andersson, under the
  [SIL Open Font License 1.1](https://openfontlicense.org). The outlines in `logo*.svg` are derived from it.
- Process: [neonwatty/logo-designer-skill](https://github.com/neonwatty/logo-designer-skill) (MIT).
- The artwork itself is released under the same terms as the rest of this repository.
