// Implements the library file system over a folder on disk that the user picked in the browser.
import { posixPathOps, type LocalStat } from "@labshelf/core";
import { ByteBackedFileSystem } from "../byteBacked";

type Entry = FileSystemDirectoryHandle | FileSystemFileHandle;

const segments = (path: string): string[] => path.split("/").filter((name) => name !== "" && name !== ".");
const isMissing = (error: unknown): boolean =>
  ["NotFoundError", "TypeMismatchError"].includes((error as { name?: unknown } | null)?.name as string);

export class DirectoryFileSystem extends ByteBackedFileSystem {
  /** @param root resolves the picked folder each call, and throws when the browser does not let LabShelf use it */
  constructor(private readonly root: () => Promise<FileSystemDirectoryHandle>) {
    super();
  }

  async listDir(dirPath: string): Promise<string[]> {
    const names: string[] = [];
    try {
      for await (const name of (await this.dir(dirPath, false)).keys()) names.push(name);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return names;
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const found = await this.entry(filePath);
    if (found?.kind !== "file") throw new Error(`File not found: ${filePath}`);
    return new Uint8Array(await (await found.getFile()).arrayBuffer());
  }

  /** PLATFORM: a writable stream writes a swap file that replaces the target on close, so a reader never sees half. */
  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const { parent, name } = await this.parentOf(filePath, true);
    const writable = await (await parent.getFileHandle(name, { create: true })).createWritable();
    try {
      await writable.write(content as Uint8Array<ArrayBuffer>);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    await this.remove(filePath, false);
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    const found = await this.entry(targetPath);
    if (!found) return undefined;
    if (found.kind === "directory") return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
    const file = await found.getFile();
    return { isFile: true, isDirectory: false, mtimeMs: file.lastModified, size: file.size };
  }

  async ensureDir(dirPath: string): Promise<void> {
    await this.dir(dirPath, true);
  }

  /**
   * On a case-insensitive disk a case-only target is the source itself, so only the listed names tell a second entry
   * apart, and the move goes through a temporary name so the copy never lands on its own source.
   */
  async rename(from: string, to: string): Promise<void> {
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    const taken = caseOnly
      ? (await this.listDir(posixPathOps.dirname(to))).includes(posixPathOps.basename(to))
      : await this.exists(to);
    if (taken) throw new Error(`Cannot rename "${from}": "${to}" already exists`);
    if (!caseOnly) return this.move(from, to);
    const step = `${to}.renaming-${Date.now()}`;
    await this.move(from, step);
    await this.move(step, to);
  }

  async removeTree(target: string): Promise<void> {
    await this.remove(target, true);
  }

  async mkdir(dir: string): Promise<void> {
    await this.ensureDir(dir);
  }

  private async dir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = await this.root();
    for (const name of segments(path)) dir = await dir.getDirectoryHandle(name, { create });
    return dir;
  }

  private async parentOf(path: string, create: boolean): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const names = segments(path);
    const name = names.pop();
    if (name === undefined) throw new Error(`"${path}" names the library folder itself, not an entry in it`);
    return { parent: await this.dir(names.join("/"), create), name };
  }

  /** @returns undefined when the entry, or a folder above it, does not exist */
  private async entry(path: string): Promise<Entry | undefined> {
    if (segments(path).length === 0) return this.root();
    try {
      const { parent, name } = await this.parentOf(path, false);
      return await parent.getFileHandle(name).catch((error: unknown) => {
        if ((error as { name?: unknown }).name !== "TypeMismatchError") throw error;
        return parent.getDirectoryHandle(name);
      });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  /** A missing target is already removed. */
  private async remove(path: string, recursive: boolean): Promise<void> {
    try {
      const { parent, name } = await this.parentOf(path, false);
      await parent.removeEntry(name, { recursive });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  // PLATFORM: Chromium cannot move an entry of a folder on disk, so a rename copies, then deletes the source.
  private async move(from: string, to: string): Promise<void> {
    const source = await this.entry(from);
    if (!source) throw new Error(`Cannot rename "${from}": it does not exist`);
    try {
      await this.copy(source, to);
    } catch (error) {
      await this.removeTree(to).catch(() => undefined);
      throw error;
    }
    await this.removeTree(from);
  }

  private async copy(source: Entry, to: string): Promise<void> {
    if (source.kind === "file") {
      await this.writeFile(to, new Uint8Array(await (await source.getFile()).arrayBuffer()));
      return;
    }
    await this.ensureDir(to);
    for await (const [name, child] of source.entries()) await this.copy(child, `${to}/${name}`);
  }
}
