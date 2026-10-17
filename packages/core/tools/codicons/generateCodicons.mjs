// Writes src/ui/icons/codiconGlyphs.ts from the SVGs of @vscode/codicons named in codicons.json; `--check` fails when the file is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = dirname(fileURLToPath(import.meta.url));
const output = join(toolDir, "../../src/ui/icons/codiconGlyphs.ts");
const svgDir = join(dirname(createRequire(import.meta.url).resolve("@vscode/codicons/package.json")), "src/icons");
const map = JSON.parse(readFileSync(join(toolDir, "codicons.json"), "utf8"));

// INVARIANT: icon() draws every codicon on a 16x16 grid, so other grids are rejected here instead of rendering misaligned.
function innerMarkup(file) {
  const svg = readFileSync(join(svgDir, `${file}.svg`), "utf8").trim();
  const open = svg.match(/^<svg[^>]*?(\/?)>/);
  if (!open?.[0].includes('viewBox="0 0 16 16"')) throw new Error(`codicon "${file}" is not drawn on a 16x16 grid`);
  return open[1] ? "" : svg.slice(open[0].length, svg.lastIndexOf("</svg>"));
}

const quote = (markup) => `'${markup.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
const entries = Object.entries(map).map(([name, file]) => `  ${JSON.stringify(name)}: ${quote(innerMarkup(file))},`);
const source = `/**
 * Declares the SVG bodies of the codicons the apps draw, on a 16x16 grid; licence in LICENSE-codicons.md.
 * Generated from tools/codicons/codicons.json by \`pnpm --filter @labshelf/core codicons\`; do not edit by hand.
 */
export const CODICON_GLYPHS = {
${entries.join("\n")}
} as const;
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(output, "utf8");
  } catch {
    // A missing file is stale like any other difference.
  }
  if (current !== source) {
    console.error("codiconGlyphs.ts is out of date; run `pnpm --filter @labshelf/core codicons`.");
    process.exit(1);
  }
} else {
  writeFileSync(output, source);
}
