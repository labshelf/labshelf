// Implements the library file system over the bridge host, which serves the library folder on disk.
import { BridgeError, type LocalStat } from "@labshelf/core";
import type { BridgeConnection } from "./connection";
import { BytesFileSystem } from "../idb";

export class BridgeFileSystem extends BytesFileSystem {
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

  /** The host overwrites an existing target, so the port's refusal happens here. */
  async rename(from: string, to: string): Promise<void> {
    if (await this.isRenameTargetTaken(from, to)) throw new BridgeError("io", `Cannot rename ${from} to ${to}: the target already exists`);
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
