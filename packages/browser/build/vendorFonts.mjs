/**
 * Copies the source editor's code fonts (Latin, regular and bold) and their OFL licences from @fontsource into libraryPage/fonts/.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// INVARIANT: matches the @font-face rules of src/libraryPage/codeFonts.css and CODE_FONTS in @labshelf/core.
const FONTS = ["jetbrains-mono", "fira-code", "atkinson-hyperlegible-mono", "opendyslexic"];

export async function vendorFonts({ outDir, pkgRoot }) {
  const require = createRequire(join(pkgRoot, "package.json"));
  const fontsDir = join(outDir, "libraryPage/fonts");
  await mkdir(fontsDir, { recursive: true });
  for (const font of FONTS) {
    const root = dirname(require.resolve(`@fontsource/${font}/package.json`));
    await copyFile(join(root, "LICENSE"), join(fontsDir, `${font}-LICENSE.txt`));
    for (const weight of [400, 700]) {
      const file = `${font}-latin-${weight}-normal.woff2`;
      await copyFile(join(root, "files", file), join(fontsDir, file));
    }
  }
}
