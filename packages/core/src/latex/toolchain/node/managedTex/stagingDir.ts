// Runs an install step in a fresh staging directory under the shared TeX folder and always removes it afterwards.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

/** Calls `step` with an empty directory inside `texRoot`, so the final rename stays on one file system. */
export async function withStagingDir<T>(texRoot: string, prefix: string, step: (staging: string) => Promise<T>): Promise<T> {
  await mkdir(texRoot, { recursive: true });
  const staging = await mkdtemp(join(texRoot, `.staging-${prefix}-`));
  try {
    return await step(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
