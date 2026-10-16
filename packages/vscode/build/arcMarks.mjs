/** Bakes the mark SVGs that native tree icons use into out/marks/: one Arc mark per tone, progress and theme, and the Unread dot and the REF glyph per theme. */
// PLATFORM: TreeItem icons cannot read CSS variables, and the workbench CSP blocks icons served from globalStorage (vscode-userdata:), so the files ship inside the extension folder.
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES = ["light", "dark"];

/** Core is TypeScript source; bundling the mark and token files alone (the package index would pull in the whole of core) and loading the result from memory needs no build step in core. */
async function loadMarkApi() {
  const bundle = await build({
    stdin: {
      contents: [
        'export { ARC_TONES, ARC_PROGRESSES, ARC_TONE_COLORS, STATUS_ARC, arcMark, statusMark } from "../../core/src/ui/icons/arcMark.ts";',
        'export { FILE_TYPE_TOKENS } from "../../core/src/ui/tokens/colorTokens.ts";',
        'export { TYPE_TOKENS } from "../../core/src/ui/tokens/scaleTokens.ts";',
      ].join("\n"),
      resolveDir: here,
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
  });
  const source = bundle.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

/** The REF glyph paper rows show: bold text in the mono font and the file-ref colour. */
function refMark(color, font) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">`
    + `<text x="8" y="11.5" text-anchor="middle" font-family='${font}' font-weight="700" font-size="7" fill="${color}">REF</text></svg>`;
}

export async function arcMarkFiles() {
  const { ARC_TONES, ARC_PROGRESSES, ARC_TONE_COLORS, STATUS_ARC, FILE_TYPE_TOKENS, TYPE_TOKENS, arcMark, statusMark } = await loadMarkApi();
  const { value: dark, light } = FILE_TYPE_TOKENS["file-ref"];
  const refColor = { dark, light: light ?? dark };
  const arcs = ARC_TONES.flatMap((tone) => ARC_PROGRESSES.flatMap((progress) => THEMES.map((theme) => ({
    name: `${tone}-${progress}-${theme}.svg`,
    svg: arcMark(tone, progress, ARC_TONE_COLORS[tone][theme]),
  }))));
  const unread = THEMES.map((theme) => ({ name: `unread-${theme}.svg`, svg: statusMark("unread", ARC_TONE_COLORS[STATUS_ARC.unread[0]][theme]) }));
  return [...arcs, ...unread, ...THEMES.map((theme) => ({ name: `ref-${theme}.svg`, svg: refMark(refColor[theme], TYPE_TOKENS.mono.value) }))];
}

export async function writeArcMarks(outDir) {
  const marksDir = join(outDir, "marks");
  await mkdir(marksDir, { recursive: true });
  const files = await arcMarkFiles();
  await Promise.all(files.map(({ name, svg }) => writeFile(join(marksDir, name), svg)));
  return files.length;
}
