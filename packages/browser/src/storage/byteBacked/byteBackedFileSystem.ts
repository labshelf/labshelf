// Derives text access and existence checks for library file systems that store raw bytes.
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

export abstract class ByteBackedFileSystem implements LibraryFileSystem {
  abstract listDir(dirPath: string): Promise<string[]>;
  abstract readFile(filePath: string): Promise<Uint8Array>;
  abstract writeFile(filePath: string, content: Uint8Array): Promise<void>;
  abstract deleteFile(filePath: string): Promise<void>;
  abstract stat(targetPath: string): Promise<LocalStat | undefined>;
  abstract ensureDir(dirPath: string): Promise<void>;
  abstract rename(from: string, to: string): Promise<void>;
  abstract removeTree(target: string): Promise<void>;
  abstract mkdir(dir: string): Promise<void>;

  /** A byte-backed store has no trash, so trashing deletes permanently. */
  trash(target: string): Promise<void> {
    return this.removeTree(target);
  }

  async exists(targetPath: string): Promise<boolean> {
    return (await this.stat(targetPath)) !== undefined;
  }

  async writeText(filePath: string, text: string): Promise<void> {
    await this.writeFile(filePath, new TextEncoder().encode(text));
  }

  async readText(filePath: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(filePath));
  }
}
