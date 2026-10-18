// Downloads the pinned Tinymist binary, verifies it and moves it into its version folder, removing older versions.
// CONTRACT: documents/contracts/managed-tools.md#tinymist
import { chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import { downloadVerified, type FetchLike } from "../../../latex/toolchain/node/index.js";
import type { TinymistAsset } from "../index.js";

export const TINYMIST_MODULE = "ManagedTinymist";

export interface TinymistInstallRun {
  /** The `tinymist/` subfolder of the shared tools folder. */
  folder: string;
  asset: TinymistAsset;
  fetchImpl: FetchLike;
  logger: ILogger;
  onProgress: (p: { message: string; fraction?: number }) => void;
}

async function removeOlderVersions({ folder, asset, logger }: TinymistInstallRun): Promise<void> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === asset.version) { continue; }
    await rm(join(folder, entry.name), { recursive: true, force: true });
    await logger.log("INFO", TINYMIST_MODULE, "Removed an older Tinymist", { folder, version: entry.name });
  }
}

/** Installs the binary at `<folder>/<version>/<binaryName>`; the caller holds the folder's lock. */
export async function installTinymist(run: TinymistInstallRun): Promise<string> {
  const { folder, asset } = run;
  await mkdir(folder, { recursive: true });
  const staging = await mkdtemp(join(folder, ".staging-"));
  try {
    run.onProgress({ message: `Downloading Tinymist ${asset.version}`, fraction: 0 });
    const bytes = await downloadVerified(asset.url, asset.sha256, run.fetchImpl);
    run.onProgress({ message: `Installing Tinymist ${asset.version}`, fraction: 0.9 });
    const staged = join(staging, asset.binaryName);
    await writeFile(staged, bytes, { mode: 0o755 });
    // TRAP: the umask can strip bits from the mode given to writeFile.
    await chmod(staged, 0o755);
    const target = join(folder, asset.version);
    await rm(target, { recursive: true, force: true });
    await chmod(staging, 0o755);
    await rename(staging, target);
    await removeOlderVersions(run);
    run.onProgress({ message: `Tinymist ${asset.version} is installed`, fraction: 1 });
    return join(target, asset.binaryName);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
