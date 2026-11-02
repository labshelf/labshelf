// Keeps the managed chrome-headless-shell under the shared tools folder: its pin (one Chrome for Testing Stable version, its zip, SHA-256 and executable per platform), its layout, its status, and its install under the tools lock.
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  downloadVerified, extractArchive, removeQuarantine, resolveSharedToolsDir, withStagingDir, withToolLock,
} from "../../latex/node/index.js";
import type { FetchLike, ILogger } from "../../ports/index.js";

export interface ChromiumPinEntry { url: string; sha256: string; executable: string }

export interface ChromiumPin { version: string; platforms: Partial<Record<"darwin-arm64" | "darwin-x64" | "linux-x64" | "win32-x64", ChromiumPinEntry>> }

const VERSION = "156.0.8078.80";

function entry(cft: string, sha256: string, exe = ""): ChromiumPinEntry {
  return {
    url: `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/${cft}/chrome-headless-shell-${cft}.zip`,
    sha256,
    executable: `chrome-headless-shell-${cft}/chrome-headless-shell${exe}`,
  };
}

// Taken 2026-11-01 from the Chrome for Testing Stable channel; each sha256 was computed from the downloaded zip.
// linux-arm64 has no chrome-headless-shell build, so it has no entry.
const PIN: ChromiumPin = {
  version: VERSION,
  platforms: {
    "darwin-arm64": entry("mac-arm64", "ea615baa2e9caf0d02d1898a6562b5f8fa9c35239707dae0f592178df5b986ac"),
    "darwin-x64": entry("mac-x64", "535d417d9034cbd11e7dacd1a71aa3d6e1b525e6d5dcd2671eb2532f01481228"),
    "linux-x64": entry("linux64", "547dcd374e02961bf998f6046a267644f8502225c36bb78ca307dab32a0b3eb4"),
    "win32-x64": entry("win64", "10a77466005e7f64e00f1a75fd1ea81f4a38a60093c65fea6895843b26e60a9a", ".exe"),
  },
};

/** A fresh deep copy of the pin, so callers may change it freely. */
export function chromiumPin(): ChromiumPin {
  const platforms: ChromiumPin["platforms"] = {};
  for (const [key, value] of Object.entries(PIN.platforms)) {
    platforms[key as keyof ChromiumPin["platforms"]] = { ...value };
  }
  return { version: PIN.version, platforms };
}

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

interface ChromiumInstall { options: ManagedChromiumOptions; pin: ChromiumPin; chromeDir: string; versionDir: string; status: () => Promise<ManagedChromiumStatus> }

async function unpackChromium(install: ChromiumInstall, entry: ChromiumPinEntry, bytes: Buffer, onProgress: (message: string) => void, signal?: AbortSignal): Promise<void> {
  const { options, chromeDir, versionDir } = install;
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
}

async function installLocked(install: ChromiumInstall, entry: ChromiumPinEntry, onProgress: (message: string) => void, signal?: AbortSignal): Promise<string> {
  const { options, pin, chromeDir, versionDir } = install;
  const { logger } = options;
  const executable = join(versionDir, entry.executable);
  // Another process may have installed the same pin while this one waited for the lock.
  const current = await readInstalledPin(chromeDir);
  if ((await install.status()).installed && current?.sha256 === entry.sha256) {
    await logger.log("INFO", MODULE, "chrome-headless-shell was installed by another LabShelf process while waiting", { versionDir });
    onProgress("Done");
    return executable;
  }
  onProgress(`Downloading chrome-headless-shell ${pin.version}`);
  await logger.log("INFO", MODULE, "Downloading chrome-headless-shell", { url: entry.url, version: pin.version });
  const bytes = await downloadVerified(entry.url, entry.sha256, options.fetchImpl, signal);
  await unpackChromium(install, entry, bytes, onProgress, signal);
  if (options.platform === "darwin") { await removeQuarantine(versionDir, logger); }
  await writeFile(join(chromeDir, PIN_FILE), JSON.stringify({ version: pin.version, sha256: entry.sha256 }));
  await logger.log("INFO", MODULE, "chrome-headless-shell installed", { version: pin.version, executable });
  onProgress("Done");
  return executable;
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

  const install: ChromiumInstall = { options, pin, chromeDir, versionDir, status };
  return {
    status,
    async install(onProgress = () => undefined, signal) {
      const entry = entryFor(pin, key);
      if (!entry) { throw new Error(`chrome-headless-shell has no build for ${key}.`); }
      try {
        return await withToolLock(toolsDir, "chrome install", logger, () => installLocked(install, entry, onProgress, signal));
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
