/** Bakes the mark SVGs that native tree icons use into out/marks/: one Arc mark per tone, progress and theme. */
// PLATFORM: TreeItem icons cannot read CSS variables, and the workbench CSP blocks icons served from globalStorage (vscode-userdata:), so the files ship inside the extension folder.
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const THEMES = ["light", "dark"];

/** Core is TypeScript source; bundling the mark file alone (the package index would pull in the whole of core) and loading the result from memory needs no build step in core. */
async function loadMarkApi() {
  const bundle = await build({
    stdin: {
      contents: 'export { ARC_TONES, ARC_PROGRESSES, ARC_TONE_COLORS, arcMark } from "../../core/src/ui/icons/arcMark.ts";',
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

export async function arcMarkFiles() {
  const { ARC_TONES, ARC_PROGRESSES, ARC_TONE_COLORS, arcMark } = await loadMarkApi();
  return ARC_TONES.flatMap((tone) => ARC_PROGRESSES.flatMap((progress) => THEMES.map((theme) => ({
    name: `${tone}-${progress}-${theme}.svg`,
    svg: arcMark(tone, progress, ARC_TONE_COLORS[tone][theme]),
  }))));
}

export async function writeArcMarks(outDir) {
  const marksDir = join(outDir, "marks");
  await mkdir(marksDir, { recursive: true });
  const files = await arcMarkFiles();
  await Promise.all(files.map(({ name, svg }) => writeFile(join(marksDir, name), svg)));
  return files.length;
}
