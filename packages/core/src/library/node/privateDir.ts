// Creates a folder only its owner can use, and tells whether a mode lets the group or others write.
import { promises as fs } from "node:fs";

/** Mode of a folder only its owner can use. */
export const PRIVATE_DIR_MODE = 0o700;
/** Mode of a file only its owner can read. */
export const PRIVATE_FILE_MODE = 0o600;

/**
 * Creates the folder and its missing parents, then sets the folder itself to 0o700 even when it already existed.
 * PLATFORM: Windows has no POSIX modes; callers skip this there.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  await fs.chmod(dir, PRIVATE_DIR_MODE);
}

export function isGroupOrOtherWritable(mode: number): boolean {
  return (mode & 0o022) !== 0;
}
