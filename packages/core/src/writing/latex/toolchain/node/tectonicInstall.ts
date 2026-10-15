// Downloads the pinned Tectonic release on demand and installs it into the extension's storage folder.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import { TECTONIC_VERSION, tectonicAsset } from "../tectonicRelease.js";
import { downloadVerified, type FetchLike } from "./downloadVerified.js";
import { extractArchive } from "./extractArchive.js";
import { removeOtherTectonicVersions, tectonicRoot, tectonicVersionDir } from "./tectonicStore.js";

const MODULE = "writing/toolchain";

export interface TectonicInstallOptions {
  logger: ILogger;
  signal?: AbortSignal;
  /** Replaces the global fetch; tests serve the archive from memory. */
  fetch?: FetchLike;
}

async function install(storageDir: string, options: TectonicInstallOptions): Promise<string> {
  const asset = tectonicAsset(process.platform, process.arch);
  if (!asset) { throw new Error(`Tectonic ${TECTONIC_VERSION} has no build for ${process.platform}-${process.arch}`); }
  const { signal } = options;
  const bytes = await downloadVerified(asset.url, asset.sha256, options.fetch ?? fetch, signal);

  // The staging folder lives next to the final one so the closing rename stays on one file system and a half-finished
  // install never sits at the installed path.
  await fs.mkdir(tectonicRoot(storageDir), { recursive: true });
  const staging = await fs.mkdtemp(path.join(tectonicRoot(storageDir), ".install-"));
  try {
    const archive = path.join(staging, `tectonic.${asset.archive}`);
    const unpacked = path.join(staging, "unpacked");
    await fs.mkdir(unpacked);
    await fs.writeFile(archive, bytes);
    await extractArchive(archive, asset.archive, unpacked, signal);
    const binary = path.join(unpacked, asset.binary);
    await fs.stat(binary).catch(() => { throw new Error(`The Tectonic archive from ${asset.url} holds no ${asset.binary}`); });
    if (process.platform !== "win32") { await fs.chmod(binary, 0o755); }
    signal?.throwIfAborted();
    const versionDir = tectonicVersionDir(storageDir);
    await fs.rm(versionDir, { recursive: true, force: true });
    await fs.rename(unpacked, versionDir);
    await removeOtherTectonicVersions(storageDir);
    return path.join(versionDir, asset.binary);
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

/** Installs the pinned Tectonic and returns its binary path; leaves no partial files when it fails or is aborted. */
export async function installTectonic(storageDir: string, options: TectonicInstallOptions): Promise<string> {
  const url = tectonicAsset(process.platform, process.arch)?.url;
  const context = { version: TECTONIC_VERSION, platform: process.platform, arch: process.arch, url };
  await options.logger.log("INFO", MODULE, "Installing Tectonic", context);
  try {
    const binary = await install(storageDir, options);
    await options.logger.log("INFO", MODULE, "Installed Tectonic", { ...context, binary });
    return binary;
  } catch (error) {
    await options.logger.error(MODULE, error, context);
    throw error;
  }
}
