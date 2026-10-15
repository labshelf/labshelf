// Locates installed Tectonic versions inside the extension's storage folder.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { TECTONIC_VERSION } from "../tectonicRelease.js";

export function tectonicRoot(storageDir: string): string {
  return path.join(storageDir, "tectonic");
}

export function tectonicVersionDir(storageDir: string): string {
  return path.join(tectonicRoot(storageDir), TECTONIC_VERSION);
}

export function tectonicBinaryName(platform: string = process.platform): string {
  return platform === "win32" ? "tectonic.exe" : "tectonic";
}

/** The pinned Tectonic binary when it is installed, otherwise undefined. */
export async function installedTectonic(storageDir: string): Promise<string | undefined> {
  const binary = path.join(tectonicVersionDir(storageDir), tectonicBinaryName());
  return fs.stat(binary).then((stat) => (stat.isFile() ? binary : undefined), () => undefined);
}

/** Deletes every version folder of Tectonic except the pinned one. */
export async function removeOtherTectonicVersions(storageDir: string): Promise<void> {
  const entries = await fs.readdir(tectonicRoot(storageDir), { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.name !== TECTONIC_VERSION)
      .map((entry) => fs.rm(path.join(tectonicRoot(storageDir), entry.name), { recursive: true, force: true })),
  );
}
