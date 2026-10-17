// Seeds the extension's IndexedDB with a library folder: every file as a `files` row and every paper as a `metadata` row.
// The rows follow packages/browser/src/storage (idb/schema.ts, paperRecordStore.ts); records come from core's own parser.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const BATCH_BYTES = 4 * 1024 * 1024;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

/** Bundles the core functions the extension uses to derive records, so the seed matches what a sync would write. */
async function loadCoreRecords(scratchDir) {
  const outfile = join(scratchDir, "core-records.mjs");
  await build({
    stdin: {
      contents: `export { METADATA_FILE, paperRecordFromMetadata, parsePaperMetadata, pdfDirsFromFilePaths } from ${JSON.stringify(join(repo, "packages/core/src/index.ts"))};`,
      resolveDir: repo,
      loader: "ts",
    },
    bundle: true, format: "esm", platform: "neutral", outfile, logLevel: "error", mainFields: ["module", "main"],
  });
  return import(outfile);
}

async function readLibrary(libraryDir, core) {
  const files = await Promise.all((await walk(libraryDir)).map(async (abs) => {
    const bytes = await readFile(abs);
    const path = relative(libraryDir, abs).split(sep).join("/");
    return { path, bytes, hash: createHash("sha256").update(bytes).digest("hex") };
  }));
  const pdfs = core.pdfDirsFromFilePaths(files.map((f) => f.path));
  const records = files.filter((f) => f.path.startsWith("papers/") && f.path.endsWith(`/${core.METADATA_FILE}`)).map((f) => {
    const folderPath = f.path.slice(0, -`/${core.METADATA_FILE}`.length);
    const id = folderPath.slice(folderPath.lastIndexOf("/") + 1);
    const meta = core.parsePaperMetadata(f.bytes.toString("utf8"));
    if (!meta) throw new Error(`seed: unreadable ${f.path}`);
    return { paperId: id, folderPath, record: core.paperRecordFromMetadata(meta, { id, path: folderPath, hasPdf: pdfs.has(folderPath) }) };
  });
  return { files, records };
}

// Runs inside the extension's service worker, so the rows land in the extension origin's database.
function putRows({ store, rows }) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("labshelf");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(store, "readwrite");
      for (const row of rows) {
        if (row.base64 !== undefined) {
          row.bytes = Uint8Array.from(atob(row.base64), (c) => c.charCodeAt(0));
          delete row.base64;
        }
        tx.objectStore(store).put(row);
      }
      tx.oncomplete = () => { open.result.close(); resolve(rows.length); };
      tx.onerror = () => reject(tx.error);
    };
  });
}

/**
 * Writes the library into the extension's IndexedDB through its service worker.
 * @param {import("playwright-core").Worker} worker the extension's background worker
 * @returns {Promise<number>} how many papers were seeded
 */
export async function seedLibrary(worker, libraryDir, scratchDir) {
  const { files, records } = await readLibrary(libraryDir, await loadCoreRecords(scratchDir));
  const mtime = Date.now();
  let batch = [];
  let size = 0;
  for (const [i, file] of files.entries()) {
    batch.push({ path: file.path, base64: file.bytes.toString("base64"), mtime, hash: file.hash });
    size += file.bytes.length;
    if (size < BATCH_BYTES && i < files.length - 1) continue;
    await worker.evaluate(putRows, { store: "files", rows: batch });
    batch = [];
    size = 0;
  }
  await worker.evaluate(putRows, { store: "metadata", rows: records });
  return records.length;
}
