// Runs an install step in a fresh staging directory under tex/ and always removes it afterwards.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** Calls `step` with an empty directory inside `<dataDir>/tex/`, so the final rename stays on one file system. */
export async function withStagingDir<T>(dataDir: string, prefix: string, step: (staging: string) => Promise<T>): Promise<T> {
  const texDir = join(dataDir, "tex");
  await mkdir(texDir, { recursive: true });
  const staging = await mkdtemp(join(texDir, `.staging-${prefix}-`));
  try {
    return await step(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
