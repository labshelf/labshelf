/** Resolves Typst packages from the folders the Typst CLI uses, and downloads missing Typst Universe packages into its cache. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { extractArchive } from "../../latex/node/index.js";
import type { TypstPackageResolver, TypstPackageSpec } from "../typstSession.js";
import { deriveTypstCompilerPath } from "./typstFileAccess.js";
import type { FetchLike } from "../../ports/index.js";

const UNIVERSE_NAMESPACE = "preview";
// Names and versions become folder names: anything else could leave the package folder.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SAFE_VERSION = /^\d+\.\d+\.\d+$/;

export interface TypstPackageDirs {
  /** Local packages (`@local/...`), which Typst never downloads. */
  data: string;
  /** Downloaded packages. */
  cache: string;
}

// The Typst CLI's own folders, so the CLI and LabShelf share every download.
export function resolveTypstPackageDirs(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): TypstPackageDirs {
  const home = os.homedir();
  const data = platform === "darwin" ? path.join(home, "Library", "Application Support")
    : platform === "win32" ? env["APPDATA"] ?? path.join(home, "AppData", "Roaming")
      : env["XDG_DATA_HOME"] ?? path.join(home, ".local", "share");
  const cache = platform === "darwin" ? path.join(home, "Library", "Caches")
    : platform === "win32" ? env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local")
      : env["XDG_CACHE_HOME"] ?? path.join(home, ".cache");
  return {
    data: env["TYPST_PACKAGE_PATH"] ?? path.join(data, "typst", "packages"),
    cache: env["TYPST_PACKAGE_CACHE_PATH"] ?? path.join(cache, "typst", "packages"),
  };
}

function isSafe(spec: TypstPackageSpec): boolean {
  return SAFE_NAME.test(spec.namespace) && SAFE_NAME.test(spec.name) && SAFE_VERSION.test(spec.version);
}

export function formatPackageLabel(spec: TypstPackageSpec): string {
  return `@${spec.namespace}/${spec.name}:${spec.version}`;
}

export class TypstPackageStore implements TypstPackageResolver {
  private readonly missing = new Map<string, TypstPackageSpec>();

  constructor(private readonly dirs: TypstPackageDirs) {}

  resolve(spec: TypstPackageSpec): string | undefined {
    if (!isSafe(spec)) { return undefined; }
    for (const root of [this.dirs.data, this.dirs.cache]) {
      const folder = path.join(root, spec.namespace, spec.name, spec.version);
      if (fs.statSync(folder, { throwIfNoEntry: false })?.isDirectory()) { return deriveTypstCompilerPath(folder); }
    }
    if (spec.namespace === UNIVERSE_NAMESPACE) { this.missing.set(formatPackageLabel(spec), spec); }
    return undefined;
  }

  /** The Typst Universe packages compiles asked for since the last call and found nowhere. */
  takeMissing(): TypstPackageSpec[] {
    const specs = [...this.missing.values()];
    this.missing.clear();
    return specs;
  }

  /** Downloads a Typst Universe package into the cache; a half-finished download never sits at the package's folder. */
  async download(spec: TypstPackageSpec, fetchImpl: FetchLike, signal?: AbortSignal): Promise<void> {
    if (spec.namespace !== UNIVERSE_NAMESPACE || !isSafe(spec)) { throw new Error(`${formatPackageLabel(spec)} is not a Typst Universe package`); }
    const url = `https://packages.typst.org/preview/${spec.name}-${spec.version}.tar.gz`;
    const response = await fetchImpl(url, signal ? { signal } : {});
    if (response.status === 404) { throw new Error(`${formatPackageLabel(spec)} does not exist on Typst Universe`); }
    if (!response.ok) { throw new Error(`Download of ${formatPackageLabel(spec)} failed with HTTP ${response.status}`); }
    const parent = path.join(this.dirs.cache, spec.namespace, spec.name);
    await fs.promises.mkdir(parent, { recursive: true });
    const staging = await fs.promises.mkdtemp(path.join(parent, ".download-"));
    try {
      const archive = path.join(staging, "package.tar.gz");
      const unpacked = path.join(staging, "unpacked");
      await fs.promises.mkdir(unpacked);
      await fs.promises.writeFile(archive, Buffer.from(await response.arrayBuffer()));
      await extractArchive(archive, "tar.gz", unpacked, signal);
      await fs.promises.rename(unpacked, path.join(parent, spec.version)).catch((error: NodeJS.ErrnoException) => {
        // Another compile or the Typst CLI installed it first.
        if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST" && error.code !== "EPERM") { throw error; }
      });
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }
  }
}
