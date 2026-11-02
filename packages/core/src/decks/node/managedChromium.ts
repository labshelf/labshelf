// Keeps the managed chrome-headless-shell under the shared tools folder: its layout, its status, and its install under the tools lock.
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  downloadVerified, extractArchive, removeQuarantine, resolveSharedToolsDir, withStagingDir, withToolLock,
} from "../../latex/node/index.js";
import type { FetchLike, ILogger } from "../../ports/index.js";
import { chromiumPin, type ChromiumPin, type ChromiumPinEntry } from "./chromiumPin.js";

// CONTRACT: documents/contracts/managed-tools.md#chrome
const MODULE = "ManagedChromium";
const PIN_FILE = "chrome-pin.json";

export interface ManagedChromiumStatus { installed: boolean; version?: string; executable?: string }

export interface ManagedChromiumOptions { toolsDir: string; platform: NodeJS.Platform; arch: string; logger: ILogger; fetchImpl: FetchLike; pin?: ChromiumPin }

export interface ManagedChromiumProvider { status(): Promise<ManagedChromiumStatus>; install(onProgress?: (message: string) => void, signal?: AbortSignal): Promise<string> }

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function entryFor(pin: ChromiumPin, key: string): ChromiumPinEntry | undefined {
  return Object.hasOwn(pin.platforms, key) ? pin.platforms[key as keyof ChromiumPin["platforms"]] : undefined;
}

async function readInstalledPin(chromeDir: string): Promise<{ version?: unknown; sha256?: unknown } | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(chromeDir, PIN_FILE), "utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function createManagedChromiumProvider(options: ManagedChromiumOptions): ManagedChromiumProvider {
  const { toolsDir, logger } = options;
  const pin = options.pin ?? chromiumPin();
  const key = `${options.platform}-${options.arch}`;
  const chromeDir = join(toolsDir, "chrome");
  const versionDir = join(chromeDir, pin.version);

  // INVARIANT: status takes no lock and creates nothing on disk.
  async function status(): Promise<ManagedChromiumStatus> {
    const entry = entryFor(pin, key);
    if (!entry) { return { installed: false }; }
    const installed = await readInstalledPin(chromeDir);
    const executable = join(versionDir, entry.executable);
    if (installed?.version !== pin.version || !(await exists(executable))) { return { installed: false }; }
    return { installed: true, version: pin.version, executable };
  }

  async function installLocked(entry: ChromiumPinEntry, onProgress: (message: string) => void, signal?: AbortSignal): Promise<string> {
    const executable = join(versionDir, entry.executable);
    // Another process may have installed the same pin while this one waited for the lock.
    const current = await readInstalledPin(chromeDir);
    if ((await status()).installed && current?.sha256 === entry.sha256) {
      await logger.log("INFO", MODULE, "chrome-headless-shell was installed by another LabShelf process while waiting", { versionDir });
      onProgress("Done");
      return executable;
    }
    onProgress(`Downloading chrome-headless-shell ${pin.version}`);
    await logger.log("INFO", MODULE, "Downloading chrome-headless-shell", { url: entry.url, version: pin.version });
    const bytes = await downloadVerified(entry.url, entry.sha256, options.fetchImpl, signal);
    await mkdir(chromeDir, { recursive: true });
    await withStagingDir(chromeDir, "chrome", async (staging) => {
      const archive = join(staging, "chrome-headless-shell.zip");
      const tree = join(staging, "tree");
      await writeFile(archive, bytes);
      await mkdir(tree);
      onProgress("Unpacking");
      await extractArchive(archive, "zip", tree, signal);
      if (!(await exists(join(tree, entry.executable)))) {
        throw new Error(`The chrome-headless-shell archive has no ${entry.executable}.`);
      }
      if (options.platform !== "win32") { await chmod(join(tree, entry.executable), 0o755); }
      // INVARIANT: the pin file goes first and comes back last, so status never names a half-swapped folder.
      await rm(join(chromeDir, PIN_FILE), { force: true });
      await rm(versionDir, { recursive: true, force: true });
      await rename(tree, versionDir);
    });
    if (options.platform === "darwin") { await removeQuarantine(versionDir, logger); }
    await writeFile(join(chromeDir, PIN_FILE), JSON.stringify({ version: pin.version, sha256: entry.sha256 }));
    await logger.log("INFO", MODULE, "chrome-headless-shell installed", { version: pin.version, executable });
    onProgress("Done");
    return executable;
  }

  return {
    status,
    async install(onProgress = () => undefined, signal) {
      const entry = entryFor(pin, key);
      if (!entry) { throw new Error(`chrome-headless-shell has no build for ${key}.`); }
      try {
        return await withToolLock(toolsDir, "chrome install", logger, () => installLocked(entry, onProgress, signal));
      } catch (error) {
        await logger.error(MODULE, error, { step: "install chrome-headless-shell", key, version: pin.version });
        throw error;
      }
    },
  };
}

export function createSharedChromiumProvider(options: { env: NodeJS.ProcessEnv; platform: NodeJS.Platform; homeDir: string; logger: ILogger; fetchImpl: FetchLike }): ManagedChromiumProvider {
  const { env, platform, homeDir, logger, fetchImpl } = options;
  return createManagedChromiumProvider({ toolsDir: resolveSharedToolsDir(env, platform, homeDir), platform, arch: process.arch, logger, fetchImpl });
}
