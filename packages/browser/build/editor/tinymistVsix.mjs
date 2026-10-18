/**
 * Fetches Tinymist's pinned web VSIX from Open VSX once, checks its digest and unpacks the files the editor page loads.
 * The wasm comes from the `tinymist-web` package instead: it is the same file, and the LSP worker is built against its glue.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const TINYMIST_VERSION = "0.15.10";
const VSIX_URL = `https://open-vsx.org/api/myriad-dreamin/tinymist/web/${TINYMIST_VERSION}/file/myriad-dreamin.tinymist-${TINYMIST_VERSION}@web.vsix`;
const VSIX_SHA256 = "cb8cd3e318113dd9337a0dfa01f3873bf1f84a5ce53d48bbe88e774b35e1cd1b";

/** Paths inside the VSIX's `extension/` folder that the web extension reads. */
export const TINYMIST_FILES = [
  "package.json",
  "package.nls.json",
  "icons/ti.png",
  "icons/ti-white.png",
  "icons/typst-small.png",
  "syntaxes/language-configuration.json",
  "syntaxes/typst-markdown-injection.json",
  "out/extension.web.js",
  "out/typst.tmLanguage.json",
  "out/typst-code.tmLanguage.json",
];

async function cachedVsix(cacheDir) {
  const file = join(cacheDir, `tinymist-${TINYMIST_VERSION}-web.vsix`);
  if (!existsSync(file)) {
    const response = await fetch(VSIX_URL);
    if (!response.ok) throw new Error(`Downloading the Tinymist VSIX failed: ${response.status} ${VSIX_URL}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(`${file}.part`, Buffer.from(await response.arrayBuffer()));
    await rename(`${file}.part`, file);
  }
  const digest = createHash("sha256").update(await readFile(file)).digest("hex");
  if (digest !== VSIX_SHA256) throw new Error(`Tinymist VSIX at ${file} has sha256 ${digest}, expected ${VSIX_SHA256}; delete it to download again`);
  return file;
}

/** Unpacks TINYMIST_FILES into `targetDir`, keeping their relative paths. */
export async function unpackTinymist({ cacheDir, targetDir }) {
  const vsix = await cachedVsix(cacheDir);
  const staging = join(cacheDir, `tinymist-${TINYMIST_VERSION}`);
  // PLATFORM: Node has no zip reader; `unzip` ships with macOS and the Linux images the build runs on.
  execFileSync("unzip", ["-o", "-q", vsix, ...TINYMIST_FILES.map((f) => `extension/${f}`), "-d", staging]);
  for (const file of TINYMIST_FILES) {
    const target = join(targetDir, file);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, await readFile(join(staging, "extension", file)));
  }
}
