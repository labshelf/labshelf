// Keeps the managed pix2tex under the shared tools folder: a venv of the managed Python with hash-pinned requirements, the verified weights, and the status.
// CONTRACT: documents/contracts/managed-tools.md#pix2tex
import { mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ILogger } from "../../ports/index.js";
import { withStagingDir, withToolLock, type runCancellable } from "../../latex/node/index.js";
import type { PythonProvider } from "../../qmd/compute/node/managedPython.js";
import { PIX2TEX_PIN, pix2texPlatform } from "../pix2texPin.js";

const MODULE = "ManagedPix2tex";
const MARKER = "pix2tex-pin.json";

export interface Pix2texProvider { status(): Promise<'installed' | 'missing' | 'unsupported'>; install(onProgress: (message: string, fraction?: number) => void, signal?: AbortSignal): Promise<void>; pythonPath(): string; weightsDir(): string }

type Deps = { root: string; platform: NodeJS.Platform; arch: string; python: PythonProvider; run: typeof runCancellable; download: (url: string, sha256: string, signal?: AbortSignal) => Promise<Uint8Array>; logger: ILogger };
type Progress = (message: string, fraction?: number) => void;

function venvPython(venv: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? join(venv, "Scripts", "python.exe") : join(venv, "bin", "python3");
}

/** The requirements file of `name`, shipped beside this module. PLATFORM: core compiles to CommonJS for Node, where __dirname is this folder. */
function requirementsFile(name: string): string {
  if (typeof __dirname === "undefined") { throw new Error("The pix2tex requirements folder is unknown here"); }
  return join(__dirname, "pix2tex-requirements", name);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function markerVersion(root: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(await readFile(join(root, MARKER), "utf8")) as { version?: unknown };
    return typeof value.version === "string" ? value.version : undefined;
  } catch {
    return undefined;
  }
}

function supportedEntry(deps: Deps): { requirements: string; downloadMb: number } | null {
  const key = pix2texPlatform(deps.platform, deps.arch);
  return key === undefined ? null : PIX2TEX_PIN.platforms[key];
}

async function runStep(deps: Deps, executable: string, args: string[], cwd: string, signal: AbortSignal, step: string): Promise<void> {
  const outcome = await deps.run(executable, args, cwd, signal, { logger: deps.logger });
  if (outcome.code !== 0) { throw new Error(`${step} failed with exit code ${String(outcome.code)}: ${outcome.output.trim()}`); }
}

async function ensurePython(deps: Deps, onProgress: Progress): Promise<string> {
  if ((await deps.python.status()).state !== "installed") {
    await deps.python.install((message, fraction) => onProgress(message, fraction === undefined ? undefined : fraction * 0.1));
  }
  const base = deps.python.pythonPath?.();
  if (!base) { throw new Error("The managed Python has no interpreter path"); }
  return base;
}

/** Builds the venv and the weights in a staging folder, then moves them into place and writes the marker last. */
async function installLocked(deps: Deps, requirements: string, onProgress: Progress, signal: AbortSignal): Promise<void> {
  const { root, platform, logger } = deps;
  // Another process may have installed the same pin while this one waited for the lock.
  if ((await markerVersion(root)) === PIX2TEX_PIN.version) {
    await logger.log("INFO", MODULE, "pix2tex was installed by another LabShelf process while waiting", { root });
    onProgress("pix2tex is already installed", 1);
    return;
  }
  const base = await ensurePython(deps, onProgress);
  await withStagingDir(root, "pix2tex", async (staging) => {
    const venv = join(staging, "venv");
    onProgress("Creating the pix2tex environment", 0.1);
    await runStep(deps, base, ["-m", "venv", venv], staging, signal, "Creating the pix2tex venv");
    onProgress("Installing pix2tex and PyTorch", 0.15);
    await runStep(deps, venvPython(venv, platform), [
      "-m", "pip", "install", "--require-hashes", "--no-deps", "-r", requirementsFile(requirements),
      "--only-binary", ":all:", "--isolated", "--no-input", "--disable-pip-version-check",
    ], staging, signal, "Installing the pix2tex requirements");
    const weights = join(staging, "weights");
    await mkdir(weights, { recursive: true });
    for (const [index, weight] of PIX2TEX_PIN.weights.entries()) {
      onProgress(`Downloading ${weight.file}`, 0.7 + 0.25 * (index / PIX2TEX_PIN.weights.length));
      await writeFile(join(weights, weight.file), await deps.download(weight.url, weight.sha256, signal));
    }
    // TRAP: a venv is moved after pip ran; it works through `python -m`, but the console scripts in it keep the staging path.
    await rm(join(root, MARKER), { force: true });
    await rm(join(root, "venv"), { recursive: true, force: true });
    await rm(join(root, "weights"), { recursive: true, force: true });
    await rename(venv, join(root, "venv"));
    await rename(weights, join(root, "weights"));
    await writeFile(join(root, MARKER), JSON.stringify({ version: PIX2TEX_PIN.version }));
  });
  onProgress("pix2tex is installed", 1);
}

export function createManagedPix2texProvider(deps: { root: string; platform: NodeJS.Platform; arch: string; python: PythonProvider; run: typeof runCancellable; download: (url: string, sha256: string, signal?: AbortSignal) => Promise<Uint8Array>; logger: ILogger }): Pix2texProvider {
  const { root, platform, logger } = deps;
  return {
    // INVARIANT: status takes no lock and creates nothing on disk.
    async status() {
      if (supportedEntry(deps) === null) { return "unsupported"; }
      return (await markerVersion(root)) === PIX2TEX_PIN.version ? "installed" : "missing";
    },
    pythonPath: () => venvPython(join(root, "venv"), platform),
    weightsDir: () => join(root, "weights"),
    async install(onProgress, signal) {
      const entry = supportedEntry(deps);
      if (entry === null) { throw new Error(`pix2tex has no install for ${platform}-${deps.arch}`); }
      const existed = await exists(root);
      try {
        await withToolLock(root, "install pix2tex", logger, () => installLocked(deps, entry.requirements, onProgress, signal ?? new AbortController().signal));
      } catch (error) {
        await logger.error(MODULE, error, { step: "install pix2tex", root });
        // The lock made the folder; a failed first install leaves none behind.
        if (!existed) { await rmdir(root).catch(() => undefined); }
        throw error;
      }
    },
  };
}
