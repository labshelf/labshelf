// Derives text access, existence and rename-target checks for library file systems that store raw bytes.
import { posixPathOps, type LibraryFileSystem, type LocalStat } from "@labshelf/core";

export const isCaseOnlyRename = (from: string, to: string): boolean => from !== to && from.toLowerCase() === to.toLowerCase();

export abstract class BytesFileSystem implements LibraryFileSystem {
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

  /**
   * Whether `to` names an entry other than `from`. On a case-insensitive disk `stat` of a case-only target finds the
   * source itself, so only the listed names tell a second entry apart.
   */
  protected async isRenameTargetTaken(from: string, to: string): Promise<boolean> {
    return isCaseOnlyRename(from, to)
      ? (await this.listDir(posixPathOps.dirname(to))).includes(posixPathOps.basename(to))
      : this.exists(to);
  }

  async writeText(filePath: string, text: string): Promise<void> {
    await this.writeFile(filePath, new TextEncoder().encode(text));
  }

  async readText(filePath: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(filePath));
  }
}
