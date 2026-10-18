// Holds a library folder in memory, with hooks that fail or corrupt writes, for tests of the move to the folder.
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

export class MemoryFolderFs implements LibraryFileSystem {
  readonly files = new Map<string, Uint8Array>();
  /** Folders made by ensureDir, which stay after their files are deleted, like folders on disk. */
  readonly dirs = new Set<string>();
  /** A write to this path throws. */
  failWriteOn?: string;
  /** A read of this path throws, though the file exists. */
  failReadOn?: string;
  /** A write to this path stores different bytes than it was given. */
  corruptWriteOn?: string;

  put(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }

  text(path: string): string | undefined {
    const bytes = this.files.get(path);
    return bytes && new TextDecoder().decode(bytes);
  }

  async listDir(dir: string): Promise<string[]> {
    const prefix = dir ? `${dir}/` : "";
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.dirs]) {
      if (key.startsWith(prefix)) names.add(key.slice(prefix.length).split("/")[0]!);
    }
    return [...names];
  }

  async readFile(path: string): Promise<Uint8Array> {
    if (path === this.failReadOn) throw new Error(`unreadable ${path}`);
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`missing ${path}`);
    return bytes;
  }

  async writeFile(path: string, content: Uint8Array): Promise<void> {
    if (path === this.failWriteOn) throw new Error(`disk full at ${path}`);
    this.files.set(path, path === this.corruptWriteOn ? new Uint8Array([...content].reverse().concat([0])) : content);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async stat(path: string): Promise<LocalStat | undefined> {
    const bytes = this.files.get(path);
    if (bytes) return { isFile: true, isDirectory: false, mtimeMs: 0, size: bytes.length };
    const isDir = this.dirs.has(path) || [...this.files.keys()].some((key) => key.startsWith(`${path}/`));
    return isDir ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
  }

  async ensureDir(dir: string): Promise<void> {
    for (let path = dir; path && path !== "."; path = path.slice(0, Math.max(path.lastIndexOf("/"), 0))) this.dirs.add(path);
  }

  async exists(path: string): Promise<boolean> { return (await this.stat(path)) !== undefined; }
  async writeText(path: string, text: string): Promise<void> { await this.writeFile(path, new TextEncoder().encode(text)); }
  async readText(path: string): Promise<string> { return new TextDecoder().decode(await this.readFile(path)); }
  async rename(): Promise<void> { throw new Error("not used"); }
  async trash(target: string): Promise<void> { await this.removeTree(target); }
  async removeTree(target: string): Promise<void> {
    const inside = (key: string): boolean => key === target || key.startsWith(`${target}/`);
    for (const key of [...this.files.keys()]) if (inside(key)) this.files.delete(key);
    for (const key of [...this.dirs]) if (inside(key)) this.dirs.delete(key);
  }
  async mkdir(dir: string): Promise<void> { await this.writeFile(`${dir}/.keep`, new Uint8Array()); }
}
