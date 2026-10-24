/** Keeps Typst's default fonts in a version folder under the app's fonts folder: downloads the missing ones with their checksums checked, then reads them all. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { writeFileAtomic } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { downloadVerified, type FetchLike } from "../../latex/toolchain/node/index.js";
import { TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION, type TypstFontFile } from "../typstRelease.js";

const MODULE = "writing/typst";

export interface TypstFontOptions {
  logger: ILogger;
  signal?: AbortSignal;
  /** Replaces the global fetch; tests serve the fonts from memory. */
  fetch?: FetchLike;
}

function versionDir(fontsDir: string): string {
  return path.join(fontsDir, TYPST_VERSION);
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then((stat) => stat.isFile(), () => false);
}

/** The default fonts not stored yet; a font is only ever written after its checksum matched. */
export async function missingTypstFonts(fontsDir: string): Promise<TypstFontFile[]> {
  const present = await Promise.all(TYPST_FONTS.map((font) => exists(path.join(versionDir(fontsDir), font.file))));
  return TYPST_FONTS.filter((_, index) => !present[index]);
}

/** Every default font's bytes, downloading the missing ones first; throws when a download fails or a checksum differs. */
export async function loadTypstFonts(fontsDir: string, options: TypstFontOptions): Promise<Uint8Array[]> {
  const dir = versionDir(fontsDir);
  const missing = await missingTypstFonts(fontsDir);
  if (missing.length > 0) {
    await options.logger.log("INFO", MODULE, "Downloading Typst fonts", { count: missing.length, dir });
    await fs.mkdir(dir, { recursive: true });
    for (const font of missing) {
      const bytes = await downloadVerified(`${TYPST_FONT_BASE_URL}${font.file}`, font.sha256, options.fetch ?? fetch, options.signal);
      await writeFileAtomic(path.join(dir, font.file), bytes);
    }
  }
  return Promise.all(TYPST_FONTS.map(async (font) => new Uint8Array(await fs.readFile(path.join(dir, font.file)))));
}
