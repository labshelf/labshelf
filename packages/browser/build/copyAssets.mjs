/**
 * Copies manifests and static HTML/CSS/image files into the per-target dist folder.
 */
import { cp, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const STATIC_EXTENSIONS = new Set([".html", ".css", ".svg", ".png", ".woff", ".woff2"]);

export async function copyAssets({ srcRoot, outDir, target, pkgRoot }) {
  const manifestSrc = resolve(pkgRoot, `manifest.${target}.json`);
  if (!existsSync(manifestSrc)) {
    throw new Error(`Missing manifest for target=${target}: ${relative(pkgRoot, manifestSrc)}`);
  }
  await cp(manifestSrc, join(outDir, "manifest.json"));

  for (const file of await readdir(srcRoot, { recursive: true })) {
    // Only Chrome has offscreen documents.
    if (target === "firefox" && file.startsWith("import/")) continue;
    if (STATIC_EXTENSIONS.has(extname(file).toLowerCase())) {
      await cp(join(srcRoot, file), join(outDir, file));
    }
  }
}
