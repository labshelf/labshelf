// Gives the extension a library folder the way a user who picked one has it: the files in a directory the browser grants,
// and that directory's handle stored where the extension looks for the picked folder (packages/browser/src/storage/pickedDir.ts).
// PLATFORM: headless Chrome cannot show the folder picker, so the folder is the extension origin's private file system
// (navigator.storage.getDirectory), a real FileSystemDirectoryHandle with the same API and a permission that is always granted.
// The extension then builds its paper records from the folder itself, as it does on the first open of a picked folder.
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const BATCH_BYTES = 4 * 1024 * 1024;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return nested.flat();
}

// Runs inside the extension's service worker, so the files land in the extension origin's private file system.
async function writeFiles(files) {
  const root = await navigator.storage.getDirectory();
  for (const { path, base64 } of files) {
    const names = path.split("/");
    const name = names.pop();
    let dir = root;
    for (const part of names) dir = await dir.getDirectoryHandle(part, { create: true });
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await writable.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    await writable.close();
  }
  return files.length;
}

// Stores the folder handle under the names pickedDir.ts reads: database labshelf-library-folder, store handles, key library.
async function storePickedFolder() {
  const root = await navigator.storage.getDirectory();
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open("labshelf-library-folder", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction("handles", "readwrite");
    tx.objectStore("handles").put(root, "library");
    tx.objectStore("handles").put(crypto.randomUUID(), "libraryId");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  // Open library tabs and the popup hear this and switch to the folder, as when a user picks one.
  const channel = new BroadcastChannel("labshelf-library-folder");
  channel.postMessage("picked");
  channel.close();
}

/**
 * Puts the library into a folder the extension treats as the one its user picked.
 * @param {() => Promise<import("playwright-core").Worker>} getWorker the extension's background worker, fetched per write because Chrome stops an idle one
 * @returns {Promise<number>} how many files were written
 */
export async function seedLibrary(getWorker, libraryDir) {
  const files = await Promise.all((await walk(libraryDir)).map(async (abs) => ({ abs, path: relative(libraryDir, abs).split(sep).join("/") })));
  let batch = [];
  let size = 0;
  let written = 0;
  for (const [i, file] of files.entries()) {
    const bytes = await readFile(file.abs);
    batch.push({ path: file.path, base64: bytes.toString("base64") });
    size += bytes.length;
    if (size < BATCH_BYTES && i < files.length - 1) continue;
    written += await (await getWorker()).evaluate(writeFiles, batch);
    batch = [];
    size = 0;
  }
  await (await getWorker()).evaluate(storePickedFolder);
  return written;
}
