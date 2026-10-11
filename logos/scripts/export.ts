// Render the logo SVGs in logos/export to PNG at standard sizes (transparent background).
//   bun logos/scripts/export.ts
// Output: <name>-<size>.png where size = pixel width (icon is square; logos keep their 5:2 shape).
import { Resvg } from "@resvg/resvg-js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DIR = join(import.meta.dir, "..", "export");
const SIZES = [16, 32, 48, 192, 512, 1024, 2048];

for (const name of ["icon", "logo", "logo-dark"]) {
  const svg = await readFile(join(DIR, `${name}.svg`));
  for (const size of SIZES) {
    // The wide logos are unreadable below ~192 px wide; skip the favicon sizes for them.
    if (name !== "icon" && size < 192) continue;
    const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
    await writeFile(join(DIR, `${name}-${size}.png`), png);
  }
}
console.log("exported PNGs to", DIR);
