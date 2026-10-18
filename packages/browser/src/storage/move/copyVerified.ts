// Copies files between two libraries and proves each copy by reading it back.
import { posixPathOps, type ILogger, type LibraryFileSystem } from "@labshelf/core";

const MODULE = "browser.storage.move";

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

/** Throws on the first write or read-back mismatch; the caller removes `written` and keeps the source. */
export async function copyVerified(from: LibraryFileSystem, to: LibraryFileSystem, files: readonly string[], written: string[]): Promise<void> {
  const copied = new Map<string, Uint8Array>();
  for (const file of files) {
    const bytes = await from.readFile(file);
    await to.ensureDir(posixPathOps.dirname(file));
    await to.writeFile(file, bytes);
    written.push(file);
    copied.set(file, bytes);
  }
  for (const [file, bytes] of copied) {
    const back = await to.readFile(file);
    if (!sameBytes(bytes, back)) {
      throw new Error(`The copy of ${file} reads back different (${back.length} bytes, expected ${bytes.length})`);
    }
  }
}

/** Removes the folders a failed paper's copy created, so a retry does not take them for the paper. */
export async function removeCopies(to: LibraryFileSystem, dirs: readonly string[], logger: ILogger): Promise<void> {
  for (const dir of dirs) {
    await to.trash(dir).catch((error: unknown) => logger.error(MODULE, error, { op: "removeCopy", dir }));
  }
}

/** Copies a file that belongs to no paper only when the target lacks it; an empty folder's marker becomes a folder. */
export async function copyIfMissing(from: LibraryFileSystem, to: LibraryFileSystem, file: string): Promise<void> {
  if (posixPathOps.basename(file) === ".keep") {
    const dir = posixPathOps.dirname(file);
    if (!(await to.exists(dir))) await to.mkdir(dir);
    return;
  }
  if (await to.exists(file)) return;
  await to.ensureDir(posixPathOps.dirname(file));
  await to.writeFile(file, await from.readFile(file));
}

/** Tells whether the target holds `file` with the source's bytes; an empty folder's marker needs only the folder. */
export async function holdsCopy(from: LibraryFileSystem, to: LibraryFileSystem, file: string): Promise<boolean> {
  if (posixPathOps.basename(file) === ".keep") return to.exists(posixPathOps.dirname(file));
  if (!(await to.stat(file))?.isFile) return false;
  return sameBytes(await from.readFile(file), await to.readFile(file));
}
