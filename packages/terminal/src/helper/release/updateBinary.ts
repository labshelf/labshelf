// Swaps the running helper binary for new bytes without leaving a half-written executable.
import { chmod, rename, rm, writeFile } from "node:fs/promises";

export function oldBinaryPath(binaryPath: string): string {
  return `${binaryPath}.old`;
}

// PLATFORM: Windows cannot overwrite a running exe but can rename it; the .old copy is deleted on the next start.
export async function replaceBinary(binaryPath: string, bytes: Buffer, platform: string): Promise<void> {
  const staged = `${binaryPath}.new`;
  try {
    await writeFile(staged, bytes, { mode: 0o755 });
    await chmod(staged, 0o755);
    if (platform === "win32") { await swapOnWindows(binaryPath, staged); } else { await rename(staged, binaryPath); }
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
}

async function swapOnWindows(binaryPath: string, staged: string): Promise<void> {
  const old = oldBinaryPath(binaryPath);
  await rm(old, { force: true });
  await rename(binaryPath, old);
  try {
    await rename(staged, binaryPath);
  } catch (error) {
    await rename(old, binaryPath);
    throw error;
  }
}
