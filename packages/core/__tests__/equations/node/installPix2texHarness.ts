// Fixture of the managed pix2tex install tests: the mocked pin, fake python, pip and downloads over a temporary root, and the call snapshots.
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

export const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const WEIGHTS_BYTES = new Uint8Array(Buffer.from("fake weights"));
export const RESIZER_BYTES = new Uint8Array(Buffer.from("fake image resizer"));

// jest.mock is hoisted above the imports; the factory runs lazily, after this object exists.
export const mockPin = {
  version: "9.9.9",
  platforms: {
    "darwin-arm64": { requirements: "darwin-arm64.txt", downloadMb: 120 },
    "darwin-x64": null,
    "win32-x64": { requirements: "win32-x64.txt", downloadMb: 200 },
    "linux-x64": { requirements: "linux-x64.txt", downloadMb: 190 },
    "linux-arm64": null,
  },
  weights: [
    { file: "weights.pth", url: "https://example.test/weights.pth", sha256: "" },
    { file: "image_resizer.pth", url: "https://example.test/image_resizer.pth", sha256: "" },
  ],
};
mockPin.weights[0]!.sha256 = sha(WEIGHTS_BYTES);
mockPin.weights[1]!.sha256 = sha(RESIZER_BYTES);

jest.mock("../../../src/equations/pix2texPin.js", () => ({
  ...jest.requireActual("../../../src/equations/pix2texPin.js"),
  PIX2TEX_PIN: mockPin,
}));

import type { ILogger } from "../../../src/ports/index.js";
import type { PythonProvider, PythonStatus } from "../../../src/qmd/compute/node/managedPython.js";
import { createManagedPix2texProvider, type Pix2texProvider } from "../../../src/equations/node/installPix2tex.js";
import { type Pix2texPlatform } from "../../../src/equations/pix2texPin.js";

export const INSTALLED: PythonStatus = { state: "installed", version: "3.12.7", sympy: "1.13.3" };
export const BASE_PYTHON = "/managed/python/bin/python3";
export const ALL_PLATFORMS: Pix2texPlatform[] = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64", "linux-arm64"];

export interface Call { kind: string; detail: string; lock: boolean; staging: boolean; venv: boolean; weights: boolean; marker: boolean }

export interface Fixture {
  tmp: string;
  root: string;
  events: string[];
  calls: Call[];
  runs: Array<{ executable: string; args: string[]; cwd: string; signal: unknown }>;
  downloads: Array<{ url: string; sha256: string }>;
  progress: Array<{ message: string; fraction?: number }>;
  failPip: { code: number | null };
  failDownload: { url: string | null };
  pythonInstalled: { value: boolean };
  provider: Pix2texProvider;
  platform: NodeJS.Platform;
  pipGate: { promise: Promise<void> | null };
}

const tmpDirs: string[] = [];
export async function removeTmpDirs(): Promise<void> {
  while (tmpDirs.length > 0) { await rm(tmpDirs.pop() as string, { recursive: true, force: true }); }
}

export async function names(dir: string): Promise<string[]> {
  try { return await readdir(dir); } catch { return []; }
}

export async function makeFixture(platform: NodeJS.Platform = "linux", arch = "x64", pythonInstalled = true): Promise<Fixture> {
  const tmp = await mkdtemp(join(tmpdir(), "pix2tex-test-"));
  tmpDirs.push(tmp);
  const root = join(tmp, "pix2tex");
  const events: string[] = [];
  const calls: Call[] = [];
  const runs: Fixture["runs"] = [];
  const downloads: Fixture["downloads"] = [];
  const progress: Fixture["progress"] = [];
  const failPip: Fixture["failPip"] = { code: 0 };
  const failDownload: Fixture["failDownload"] = { url: null };
  const python = { value: pythonInstalled };
  const pipGate: Fixture["pipGate"] = { promise: null };

  const snapshot = async (kind: string, detail: string): Promise<void> => {
    const entries = await names(root);
    calls.push({
      kind, detail,
      lock: entries.includes(".lock"),
      staging: entries.some((name) => name.startsWith(".staging-")),
      venv: entries.includes("venv"),
      weights: entries.includes("weights"),
      marker: entries.includes("pix2tex-pin.json"),
    });
  };

  const pythonProvider: PythonProvider = {
    status: async () => { events.push("python.status"); return python.value ? INSTALLED : { state: "missing" }; },
    install: async () => { events.push("python.install"); python.value = true; return INSTALLED; },
    pythonPath: () => BASE_PYTHON,
  };

  const run = (async (executable: string, args: string[], cwd: string, signal: AbortSignal) => {
    runs.push({ executable, args, cwd, signal });
    const isVenv = args[0] === "-m" && args[1] === "venv";
    events.push(isVenv ? "run:venv" : "run:pip");
    await snapshot(isVenv ? "venv" : "pip", args.join(" "));
    if (isVenv) {
      const target = args[2] as string;
      const exe = platform === "win32" ? join(target, "Scripts", "python.exe") : join(target, "bin", "python3");
      await mkdir(dirname(exe), { recursive: true });
      await writeFile(exe, "#!fake python");
      return { code: 0, output: "" };
    }
    if (pipGate.promise) {
      await new Promise<void>((resolveGate, rejectGate) => {
        signal.addEventListener("abort", () => rejectGate(new Error("aborted")), { once: true });
        void pipGate.promise?.then(resolveGate);
      });
    }
    return { code: failPip.code, output: failPip.code === 0 ? "" : "ERROR: THESE PACKAGES DO NOT MATCH THE HASHES" };
  }) as unknown as Parameters<typeof createManagedPix2texProvider>[0]["run"];

  const download = async (url: string, sha256: string): Promise<Uint8Array> => {
    events.push(`download:${basename(url)}`);
    downloads.push({ url, sha256 });
    await snapshot("download", url);
    if (failDownload.url === url) { throw new Error(`sha256 mismatch for ${url}`); }
    return url.endsWith("weights.pth") ? WEIGHTS_BYTES : RESIZER_BYTES;
  };

  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  const provider = createManagedPix2texProvider({ root, platform, arch, python: pythonProvider, run, download, logger });
  return { tmp, root, events, calls, runs, downloads, progress, failPip, failDownload, pythonInstalled: python, provider, platform, pipGate };
}

export const onProgress = (fx: Fixture) => (message: string, fraction?: number): void => {
  fx.progress.push(fraction === undefined ? { message } : { message, fraction });
};

export async function assertNothingInstalled(fx: Fixture): Promise<void> {
  const entries = await names(fx.root);
  expect(entries).not.toContain("venv");
  expect(entries).not.toContain("weights");
  expect(entries).not.toContain("pix2tex-pin.json");
  expect(entries.filter((name) => name.startsWith(".staging-"))).toEqual([]);
  expect(await fx.provider.status()).toBe("missing");
}
