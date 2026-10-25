// Implements the library file system over the bridge host, which serves the library folder on disk.
import { BridgeError, posixPathOps, type LocalStat } from "@labshelf/core";
import type { BridgeConnection } from "./bridgeConnection";
import { ByteBackedFileSystem } from "../bytesFileSystem";

export class BridgeFileSystem extends ByteBackedFileSystem {
  constructor(private readonly connection: () => Promise<BridgeConnection>) {
    super();
  }

  async listDir(dirPath: string): Promise<string[]> {
    return (await (await this.connection()).request({ op: "listDir", path: dirPath })).names;
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    return (await this.connection()).readFile(filePath);
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    await (await this.connection()).writeFile(filePath, content);
  }

  async deleteFile(filePath: string): Promise<void> {
    await (await this.connection()).request({ op: "deleteFile", path: filePath });
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    return (await (await this.connection()).request({ op: "stat", path: targetPath })).stat ?? undefined;
  }

  async ensureDir(dirPath: string): Promise<void> {
    await (await this.connection()).request({ op: "ensureDir", path: dirPath });
  }

  /**
   * The host overwrites an existing target, so the port's refusal happens here. On a case-insensitive disk `stat`
   * of a case-only target finds the source itself, so only the listed names tell a second file apart.
   */
  async rename(from: string, to: string): Promise<void> {
    const caseOnly = from !== to && from.toLowerCase() === to.toLowerCase();
    const taken = caseOnly
      ? (await this.listDir(posixPathOps.dirname(to))).includes(posixPathOps.basename(to))
      : await this.exists(to);
    if (taken) throw new BridgeError("io", `Cannot rename ${from} to ${to}: the target already exists`);
    await (await this.connection()).request({ op: "rename", from, to });
  }

  /** A symlink is removed as a file, never followed. */
  async removeTree(target: string): Promise<void> {
    const found = await this.stat(target);
    if (!found) return;
    const connection = await this.connection();
    if (found.isDirectory) await connection.request({ op: "deleteDir", path: target });
    else await connection.request({ op: "deleteFile", path: target });
  }

  /** A folder on disk exists while empty, so creating it is enough. */
  async mkdir(dir: string): Promise<void> {
    await this.ensureDir(dir);
  }
}
