/** Writes the demo library's metadata, sidecars and file listing into one JSON snapshot the library demo loads. */
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

const slashed = (path) => path.split(sep).join("/");

/** Reads `<pkgRoot>/demo-library` into `<outDir>/demos/library-data.json`. */
export async function writeDemoData(pkgRoot, outDir) {
  const library = join(pkgRoot, "demo-library");
  const files = [];
  const metadata = {};
  for (const abs of await walk(join(library, "papers"))) {
    const path = slashed(relative(library, abs));
    const info = await stat(abs);
    files.push({ path, size: info.size, modified: info.mtime.toISOString() });
    if (path.endsWith("/metadata.yaml")) metadata[path.slice(0, -"/metadata.yaml".length)] = await readFile(abs, "utf8");
  }
  const sidecars = {};
  const sidecarRoot = join(library, ".research/papers");
  for (const id of await readdir(sidecarRoot)) {
    sidecars[id] = JSON.parse(await readFile(join(sidecarRoot, id, "data.json"), "utf8"));
  }
  await mkdir(join(outDir, "demos"), { recursive: true });
  await writeFile(join(outDir, "demos/library-data.json"), JSON.stringify({ files, metadata, sidecars }));
}
