/**
 * Copies the two web extensions the editor page hosts, LabShelf's web build and Tinymist, into editor/extensions/<id>/,
 * wraps each CommonJS entry as an ES module and writes the file list the page registers.
 */
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { createRequire } from "node:module";
import { unpackTinymist } from "./tinymistVsix.mjs";

/** The folders of LabShelf's VS Code package its web build reads at runtime: icons and the webview bundles. */
const LABSHELF_ASSET_DIRS = ["media", "dist"];

async function listFiles(root, dir = "") {
  const out = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const rel = dir ? posix.join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(root, rel)));
    else out.push(rel);
  }
  return out;
}

// CONTRACT: the patched extension host imports `<entry>.esm.js` and calls its default export with (module, exports, require).
// It never loads the entry itself, so the wrapped copy replaces it.
async function wrapEntry(extensionDir, entry) {
  const source = await readFile(join(extensionDir, entry), "utf8");
  await writeFile(join(extensionDir, `${entry}.esm.js`), `export default function (module, exports, require) {\n${source}\n}\n`);
  await rm(join(extensionDir, entry));
}

async function finishExtension(extensionDir, entry) {
  await wrapEntry(extensionDir, entry);
  // TRAP: the patched host resolves the wrapped copy from the entry's registered URL, so the entry stays listed though it is gone.
  const files = [entry, ...(await listFiles(extensionDir)).filter((f) => f !== "files.json")];
  await writeFile(join(extensionDir, "files.json"), JSON.stringify(files));
}

async function copyLabShelf(pkgRoot, targetDir) {
  const vscodeRoot = resolve(pkgRoot, "../vscode");
  const manifest = JSON.parse(await readFile(join(vscodeRoot, "package.json"), "utf8"));
  const entry = posix.normalize(manifest.browser);
  if (!existsSync(join(vscodeRoot, entry))) {
    throw new Error(`Missing ${entry} in packages/vscode: run \`pnpm --filter @labshelf/vscode build\` before building the browser extension`);
  }
  await mkdir(dirname(join(targetDir, entry)), { recursive: true });
  await copyFile(join(vscodeRoot, "package.json"), join(targetDir, "package.json"));
  await copyFile(join(vscodeRoot, entry), join(targetDir, entry));
  for (const dir of LABSHELF_ASSET_DIRS) {
    await cp(join(vscodeRoot, dir), join(targetDir, dir), { recursive: true, filter: (path) => !path.endsWith(".map") });
  }
  await finishExtension(targetDir, entry);
}

async function copyTinymist(pkgRoot, targetDir) {
  await unpackTinymist({ cacheDir: join(pkgRoot, "node_modules/.cache/labshelf-editor"), targetDir });
  const require = createRequire(join(pkgRoot, "package.json"));
  // The LSP worker (out/web-server.js, built from src/editor) fetches the wasm next to itself.
  await copyFile(join(dirname(require.resolve("tinymist-web/package.json")), "pkg/tinymist_bg.wasm"), join(targetDir, "out/tinymist_bg.wasm"));
}

/** @param buildTinymistServer writes Tinymist's LSP worker to the given path; it runs before the file list is written so the list includes it. */
export async function copyBundledExtensions({ outDir, pkgRoot, buildTinymistServer }) {
  const extensionsDir = join(outDir, "editor/extensions");
  const labshelf = join(extensionsDir, "labshelf");
  const tinymist = join(extensionsDir, "tinymist");
  await Promise.all([
    copyLabShelf(pkgRoot, labshelf),
    copyTinymist(pkgRoot, tinymist).then(() => buildTinymistServer(join(tinymist, "out/web-server.js"))).then(() => finishExtension(tinymist, "out/extension.web.js")),
  ]);
}
