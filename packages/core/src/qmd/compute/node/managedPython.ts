// Keeps the managed Python under the shared tools folder: its layout, its status, and its install under the tool lock.
import { readFile, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FetchLike, ILogger } from "../../../ports/index.js";
import { resolveSharedToolsDir, withToolLock, type RunFile } from "../../../latex/node/index.js";
import { PYTHON_PIN } from "../pythonPin.js";
import { PIN_FILE, installPythonTree } from "./installPython.js";

const MODULE = "ManagedPython";

export type PythonStatus = { state: "missing" } | { state: "installed"; version: string; sympy: string };

export interface PythonProvider {
  status(): Promise<PythonStatus>;
  install(onProgress?: (message: string, fraction?: number) => void): Promise<PythonStatus>;
  pythonPath?(): string;
}

export interface ManagedPythonOptions {
  root: string;
  platform: NodeJS.Platform;
  arch?: string;
  logger: ILogger;
  fetchImpl: FetchLike;
  execFileImpl?: RunFile;
}

export interface SharedPythonOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDir: string;
  logger: ILogger;
  fetchImpl: FetchLike;
}

/** The interpreter and site-packages of a python-build-standalone `install_only` tree at `root`. */
export function managedPythonPaths(root: string, platform: NodeJS.Platform, version: string): { python: string; sitePackages: string } {
  if (platform === "win32") { return { python: join(root, "python.exe"), sitePackages: join(root, "Lib", "site-packages") }; }
  const majorMinor = version.split(".").slice(0, 2).join(".");
  return { python: join(root, "bin", "python3"), sitePackages: join(root, "lib", `python${majorMinor}`, "site-packages") };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// INVARIANT: status takes no lock and creates nothing on disk.
async function readStatus(options: ManagedPythonOptions): Promise<PythonStatus> {
  const { python, sitePackages } = managedPythonPaths(options.root, options.platform, PYTHON_PIN.version);
  const sympy = PYTHON_PIN.wheels.sympy.version;
  const installed = (await exists(python)) && (await exists(join(sitePackages, `sympy-${sympy}.dist-info`)));
  return installed ? { state: "installed", version: PYTHON_PIN.version, sympy } : { state: "missing" };
}

function archiveFor(options: ManagedPythonOptions): { key: string; archive: { url: string; sha256: string } } {
  const key = `${options.platform}-${options.arch ?? process.arch}`;
  const archive = Object.hasOwn(PYTHON_PIN.archives, key) ? PYTHON_PIN.archives[key as keyof typeof PYTHON_PIN.archives] : undefined;
  if (!archive) { throw new Error(`no Python build for ${key}`); }
  return { key, archive };
}

async function readPinText(root: string): Promise<string | null> {
  try {
    return JSON.stringify(JSON.parse(await readFile(join(root, PIN_FILE), "utf8")));
  } catch {
    return null;
  }
}

async function installLocked(options: ManagedPythonOptions, archive: { url: string; sha256: string }, onProgress: (message: string, fraction?: number) => void): Promise<void> {
  const { root, logger } = options;
  const pinText = JSON.stringify({ release: PYTHON_PIN.release, version: PYTHON_PIN.version, archive, wheels: PYTHON_PIN.wheels });
  // Another process may have installed the same pin while this one waited for the lock.
  if ((await readPinText(root)) === pinText && (await readStatus(options)).state === "installed") {
    await logger.log("INFO", MODULE, "Managed Python was installed by another LabShelf process while waiting", { root });
    onProgress("Python is already installed", 1);
    return;
  }
  await installPythonTree({
    root,
    platform: options.platform,
    pin: PYTHON_PIN,
    archive,
    sitePackagesIn: (tree) => managedPythonPaths(tree, options.platform, PYTHON_PIN.version).sitePackages,
    logger,
    fetchImpl: options.fetchImpl,
    execFileImpl: options.execFileImpl,
    report: (message, fraction) => onProgress(message, fraction),
  }, pinText);
}

export function createManagedPythonProvider(options: ManagedPythonOptions): PythonProvider {
  return {
    status: () => readStatus(options),
    pythonPath: () => managedPythonPaths(options.root, options.platform, PYTHON_PIN.version).python,
    async install(onProgress = () => undefined) {
      const { archive } = archiveFor(options);
      const existed = await exists(options.root);
      try {
        await withToolLock(options.root, "install python", options.logger, () => installLocked(options, archive, onProgress));
      } catch (error) {
        await options.logger.error(MODULE, error, { step: "install python", root: options.root });
        // The lock made the folder; a failed first install leaves none behind.
        if (!existed) { await rmdir(options.root).catch(() => undefined); }
        throw error;
      }
      return readStatus(options);
    },
  };
}

export function createSharedPythonProvider({ env, platform, homeDir, logger, fetchImpl }: SharedPythonOptions): PythonProvider {
  return createManagedPythonProvider({ root: join(resolveSharedToolsDir(env, platform, homeDir), "python"), platform, logger, fetchImpl });
}
