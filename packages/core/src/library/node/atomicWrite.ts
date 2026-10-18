/** Writes a file through a temp file and a rename, so no reader sees half of it. */
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

/**
 * Writes a file atomically: temp file in tmpDir (same volume as the library), then rename over the target.
 */
export async function writeFileAtomic(target: string, content: string | Uint8Array, tmpDir?: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const dir = tmpDir ?? path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await writeSyncedFile(tmp, content);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    // A temp dir on another volume (rename EXDEV) falls back to a direct write.
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      await fs.writeFile(target, content);
      return;
    }
    throw error;
  }
}

/** Writes and fsyncs a temp file, so a rename over the target never exposes an empty file after a crash. */
export async function writeSyncedFile(file: string, content: string | Uint8Array): Promise<void> {
  const handle = await fs.open(file, "w");
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
