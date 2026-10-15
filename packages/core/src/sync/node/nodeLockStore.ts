/** Stores the sync lock file over node:fs, shared by every app that syncs a library. */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LockStore } from "../../ports/index.js";

export class NodeLockStore implements LockStore {
  async createExclusive(filePath: string, text: string): Promise<boolean> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // CONTRACT: documents/contracts/sync.md#coordination-between-local-apps
    // Written whole to a private temp file, then hard-linked into place: link() fails if the lock exists, and the
    // other app can never read it empty (an O_EXCL create would be visible before its content).
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, text);
    try {
      await fs.link(tmp, filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") { return false; }
      throw error;
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  async read(filePath: string): Promise<string | undefined> {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return undefined;
    }
  }

  async write(filePath: string, text: string): Promise<void> {
    // Heartbeats replace the file whole (temp + rename): a half-written lock would read as abandoned.
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, filePath);
  }

  async remove(filePath: string): Promise<void> {
    await fs.rm(filePath, { force: true });
  }
}
