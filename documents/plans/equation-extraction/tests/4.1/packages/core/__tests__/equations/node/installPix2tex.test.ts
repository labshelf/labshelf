// Contract of the managed pix2tex install: pinned platforms and weights, the staged install under the tool lock, and the status.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const sha = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const WEIGHTS_BYTES = new Uint8Array(Buffer.from("fake weights"));
const RESIZER_BYTES = new Uint8Array(Buffer.from("fake image resizer"));

// jest.mock is hoisted above the imports; the factory runs lazily, after this object exists.
const mockPin = {
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
import { withToolLock } from "../../../src/latex/node/managedTex.js";
import type { PythonProvider, PythonStatus } from "../../../src/qmd/compute/node/managedPython.js";
import { createManagedPix2texProvider, type Pix2texProvider } from "../../../src/equations/node/installPix2tex.js";
import { pix2texPlatform, type Pix2texPin, type Pix2texPlatform } from "../../../src/equations/pix2texPin.js";

const REAL_PIN = (jest.requireActual("../../../src/equations/pix2texPin.js") as { PIX2TEX_PIN: Pix2texPin }).PIX2TEX_PIN;

// ---- fixtures ----------------------------------------------------------------------------------

const INSTALLED: PythonStatus = { state: "installed", version: "3.12.7", sympy: "1.13.3" };
const BASE_PYTHON = "/managed/python/bin/python3";
const ALL_PLATFORMS: Pix2texPlatform[] = ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64", "linux-arm64"];

interface Call { kind: string; detail: string; lock: boolean; staging: boolean; venv: boolean; weights: boolean; marker: boolean }

interface Fixture {
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
afterEach(async () => {
  while (tmpDirs.length > 0) { await rm(tmpDirs.pop() as string, { recursive: true, force: true }); }
});

async function names(dir: string): Promise<string[]> {
  try { return await readdir(dir); } catch { return []; }
}

async function makeFixture(platform: NodeJS.Platform = "linux", arch = "x64", pythonInstalled = true): Promise<Fixture> {
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

const onProgress = (fx: Fixture) => (message: string, fraction?: number): void => {
  fx.progress.push(fraction === undefined ? { message } : { message, fraction });
};

async function assertNothingInstalled(fx: Fixture): Promise<void> {
  const entries = await names(fx.root);
  expect(entries).not.toContain("venv");
  expect(entries).not.toContain("weights");
  expect(entries).not.toContain("pix2tex-pin.json");
  expect(entries.filter((name) => name.startsWith(".staging-"))).toEqual([]);
  expect(await fx.provider.status()).toBe("missing");
}

// ---- 4.1a: the install ------------------------------------------------------------------------

describe("managed pix2tex install", () => {
  it("4.1a runs python, venv, pip and the weight downloads in that order", async () => {
    const fx = await makeFixture("linux", "x64", false);
    await fx.provider.install(onProgress(fx));
    expect(fx.events).toEqual([
      "python.status", "python.install", "run:venv", "run:pip", "download:weights.pth", "download:image_resizer.pth",
    ]);
  });

  it("4.1a does not install Python again when it is already installed", async () => {
    const fx = await makeFixture("linux", "x64", true);
    await fx.provider.install(onProgress(fx));
    expect(fx.events).not.toContain("python.install");
    expect(fx.events.slice(0, 2)).toEqual(["python.status", "run:venv"]);
  });

  it("4.1a creates the venv with the managed base Python inside a staging folder of root", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    const venv = fx.runs[0] as Fixture["runs"][number];
    expect(venv.executable).toBe(BASE_PYTHON);
    expect(venv.args.slice(0, 2)).toEqual(["-m", "venv"]);
    expect(venv.args).toHaveLength(3);
    expect(venv.args[2]?.startsWith(join(fx.root, ".staging-"))).toBe(true);
  });

  it("4.1a installs the platform requirements with pip from the staging venv, hash-checked and without dependencies", async () => {
    const fx = await makeFixture("linux", "x64");
    await fx.provider.install(onProgress(fx));
    const venvDir = fx.runs[0]?.args[2] as string;
    const pip = fx.runs[1] as Fixture["runs"][number];
    expect(pip.executable).toBe(join(venvDir, "bin", "python3"));
    expect(pip.args.slice(0, 5)).toEqual(["-m", "pip", "install", "--require-hashes", "--no-deps"]);
    const at = pip.args.indexOf("-r");
    expect(at).toBeGreaterThanOrEqual(5);
    expect(basename(pip.args[at + 1] as string)).toBe("linux-x64.txt");
    expect(existsSync(pip.args[at + 1] as string)).toBe(true);
  });

  it("4.1a uses the Windows interpreter path in the staging venv on win32", async () => {
    const fx = await makeFixture("win32", "x64");
    await fx.provider.install(onProgress(fx));
    const venvDir = fx.runs[0]?.args[2] as string;
    expect(fx.runs[1]?.executable).toBe(join(venvDir, "Scripts", "python.exe"));
    const at = fx.runs[1]?.args.indexOf("-r") as number;
    expect(basename(fx.runs[1]?.args[at + 1] as string)).toBe("win32-x64.txt");
  });

  it("4.1a downloads each pinned weight by its url and sha256", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    expect(fx.downloads).toEqual(mockPin.weights.map(({ url, sha256 }) => ({ url, sha256 })));
  });

  it("4.1a holds the root lock and a staging folder during every step, and builds nothing in place", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    expect(fx.calls.map((call) => call.kind)).toEqual(["venv", "pip", "download", "download"]);
    for (const call of fx.calls) {
      expect(call).toMatchObject({ lock: true, staging: true, venv: false, weights: false, marker: false });
    }
  });

  it("4.1a releases the lock and removes the staging folder after a successful install", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    const entries = await names(fx.root);
    expect(entries).not.toContain(".lock");
    expect(entries.filter((name) => name.startsWith(".staging-"))).toEqual([]);
  });

  it("4.1a leaves the venv, the weights and the marker in place on success", async () => {
    const fx = await makeFixture();
    expect(await fx.provider.status()).toBe("missing");
    await fx.provider.install(onProgress(fx));
    expect(existsSync(join(fx.root, "venv", "bin", "python3"))).toBe(true);
    expect(new Uint8Array(await readFile(join(fx.root, "weights", "weights.pth")))).toEqual(WEIGHTS_BYTES);
    expect(new Uint8Array(await readFile(join(fx.root, "weights", "image_resizer.pth")))).toEqual(RESIZER_BYTES);
    expect(JSON.parse(await readFile(join(fx.root, "pix2tex-pin.json"), "utf8"))).toMatchObject({ version: "9.9.9" });
    expect(await fx.provider.status()).toBe("installed");
  });

  it("4.1a puts the venv python at venv/Scripts/python.exe on win32", async () => {
    const fx = await makeFixture("win32", "x64");
    await fx.provider.install(onProgress(fx));
    expect(existsSync(join(fx.root, "venv", "Scripts", "python.exe"))).toBe(true);
    expect(await fx.provider.status()).toBe("installed");
  });

  it("4.1a reports the venv python and the weights folder under root", async () => {
    const linux = await makeFixture("linux", "x64");
    expect(linux.provider.pythonPath()).toBe(join(linux.root, "venv", "bin", "python3"));
    expect(linux.provider.weightsDir()).toBe(join(linux.root, "weights"));
    const win = await makeFixture("win32", "x64");
    expect(win.provider.pythonPath()).toBe(join(win.root, "venv", "Scripts", "python.exe"));
  });

  it("4.1a reports progress while installing, with fractions between 0 and 1", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    expect(fx.progress.length).toBeGreaterThan(0);
    for (const { fraction } of fx.progress) {
      if (fraction !== undefined) { expect(fraction >= 0 && fraction <= 1).toBe(true); }
    }
  });

  it("4.1a passes an abort signal to the venv and pip runs", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    for (const call of fx.runs) { expect(call.signal).toBeInstanceOf(AbortSignal); }
  });

  it("4.1a rejects when pip exits non-zero and leaves no venv, weights, marker or staging folder", async () => {
    const fx = await makeFixture();
    fx.failPip.code = 1;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    await assertNothingInstalled(fx);
  });

  it("4.1a downloads no weights after a failed pip install", async () => {
    const fx = await makeFixture();
    fx.failPip.code = 1;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    expect(fx.downloads).toEqual([]);
  });

  it("4.1a rejects when a weight download throws and leaves no venv, weights, marker or staging folder", async () => {
    const fx = await makeFixture();
    fx.failDownload.url = mockPin.weights[1]?.url ?? null;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    await assertNothingInstalled(fx);
  });

  it("4.1a releases the lock after a failed install", async () => {
    const fx = await makeFixture();
    fx.failPip.code = 1;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    expect(await names(fx.root)).not.toContain(".lock");
  });

  it("4.1a installs after an earlier failure", async () => {
    const fx = await makeFixture();
    fx.failPip.code = 1;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    fx.failPip.code = 0;
    await fx.provider.install(onProgress(fx));
    expect(await fx.provider.status()).toBe("installed");
  });

  it("4.1a replaces an install of an older pin version", async () => {
    const fx = await makeFixture();
    await mkdir(join(fx.root, "venv"), { recursive: true });
    await writeFile(join(fx.root, "venv", "old.txt"), "old");
    await writeFile(join(fx.root, "pix2tex-pin.json"), JSON.stringify({ version: "0.0.1" }));
    expect(await fx.provider.status()).toBe("missing");
    await fx.provider.install(onProgress(fx));
    expect(await fx.provider.status()).toBe("installed");
    expect(existsSync(join(fx.root, "venv", "old.txt"))).toBe(false);
    expect(existsSync(join(fx.root, "venv", "bin", "python3"))).toBe(true);
  });

  it("4.1a stops a pip run that is aborted and leaves nothing installed", async () => {
    const fx = await makeFixture();
    fx.pipGate.promise = new Promise<void>(() => undefined);
    const controller = new AbortController();
    const settled = fx.provider.install(onProgress(fx), controller.signal).then(() => "resolved", () => "rejected");
    for (let waited = 0; waited < 200 && !fx.events.includes("run:pip"); waited += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    expect(fx.events).toContain("run:pip");
    controller.abort();
    expect(await settled).toBe("rejected");
    await assertNothingInstalled(fx);
  });

  it("4.1a waits for another holder of the root lock before running any step", async () => {
    const fx = await makeFixture();
    const logger: ILogger = { log: async () => undefined, error: async () => undefined };
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolveLocked) => { locked = resolveLocked; });
    const holder = withToolLock(fx.root, "other install", logger, async () => { locked(); await held; });
    await lockTaken;
    const install = fx.provider.install(onProgress(fx));
    await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    expect(fx.runs).toEqual([]);
    expect(fx.downloads).toEqual([]);
    release();
    await holder;
    await install;
    expect(await fx.provider.status()).toBe("installed");
  });
});

// ---- 4.1a: the status -------------------------------------------------------------------------

describe("managed pix2tex status", () => {
  it("4.1a is missing before any install and creates nothing", async () => {
    const fx = await makeFixture();
    expect(await fx.provider.status()).toBe("missing");
    expect(existsSync(fx.root)).toBe(false);
  });

  it("4.1a is installed only when the marker holds the pinned version", async () => {
    const fx = await makeFixture();
    await mkdir(fx.root, { recursive: true });
    await writeFile(join(fx.root, "pix2tex-pin.json"), JSON.stringify({ version: "9.9.9" }));
    expect(await fx.provider.status()).toBe("installed");
    await writeFile(join(fx.root, "pix2tex-pin.json"), JSON.stringify({ version: "9.9.8" }));
    expect(await fx.provider.status()).toBe("missing");
  });

  it("4.1a is missing when the marker is not JSON", async () => {
    const fx = await makeFixture();
    await mkdir(fx.root, { recursive: true });
    await writeFile(join(fx.root, "pix2tex-pin.json"), "{not json");
    expect(await fx.provider.status()).toBe("missing");
  });

  it("4.1a is missing when a venv and weights exist without the marker", async () => {
    const fx = await makeFixture();
    await mkdir(join(fx.root, "venv", "bin"), { recursive: true });
    await mkdir(join(fx.root, "weights"), { recursive: true });
    expect(await fx.provider.status()).toBe("missing");
  });

  it("4.1a is unsupported on a platform and architecture with no pin key", async () => {
    const fx = await makeFixture("freebsd", "x64");
    expect(await fx.provider.status()).toBe("unsupported");
  });

  it("4.1a is unsupported when the pin entry of the platform is null", async () => {
    expect(await (await makeFixture("darwin", "x64")).provider.status()).toBe("unsupported");
    expect(await (await makeFixture("linux", "arm64")).provider.status()).toBe("unsupported");
  });

  it("4.1a is supported on a platform whose pin entry exists", async () => {
    expect(await (await makeFixture("darwin", "arm64")).provider.status()).toBe("missing");
  });
});

// ---- 4.1b: the pin and its requirement files ---------------------------------------------------

const REQUIREMENTS_DIR = resolve(__dirname, "../../../src/equations/node/pix2tex-requirements");

/** Logical requirement lines: continuations joined, blanks, comments and option lines dropped. */
function requirementLines(text: string): string[] {
  const joined = text.replace(/\\\r?\n/g, " ");
  return joined.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("-"));
}

describe("pix2tex pin", () => {
  it("4.1b has a version", () => {
    expect(REAL_PIN.version).toMatch(/^\d+\.\d+/);
  });

  it("4.1b lists every supported platform, each with a requirements entry or null", () => {
    expect(Object.keys(REAL_PIN.platforms).sort()).toEqual([...ALL_PLATFORMS].sort());
    for (const platform of ALL_PLATFORMS) {
      const entry = REAL_PIN.platforms[platform];
      if (entry !== null) {
        expect(typeof entry.requirements).toBe("string");
        expect(entry.requirements.length).toBeGreaterThan(0);
      }
    }
  });

  it("4.1b supports at least one platform", () => {
    expect(ALL_PLATFORMS.some((platform) => REAL_PIN.platforms[platform] !== null)).toBe(true);
  });

  it("4.1b gives every supported platform a positive download size in MB", () => {
    for (const platform of ALL_PLATFORMS) {
      const entry = REAL_PIN.platforms[platform];
      if (entry !== null) {
        expect(Number.isFinite(entry.downloadMb)).toBe(true);
        expect(entry.downloadMb).toBeGreaterThan(0);
      }
    }
  });

  it("4.1b has a <platform>.txt requirements file for every supported platform", () => {
    for (const platform of ALL_PLATFORMS) {
      const entry = REAL_PIN.platforms[platform];
      if (entry !== null) {
        expect(basename(entry.requirements)).toBe(`${platform}.txt`);
        expect(existsSync(join(REQUIREMENTS_DIR, `${platform}.txt`))).toBe(true);
      }
    }
  });

  it("4.1b pins every requirement with == and a sha256 hash, and lists at least one requirement", () => {
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] === null) { continue; }
      const lines = requirementLines(readFileSync(join(REQUIREMENTS_DIR, `${platform}.txt`), "utf8"));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatch(/==/);
        expect(line).toMatch(/--hash=sha256:[0-9a-f]{64}/);
      }
    }
  });

  it("4.1b has a 64-hex sha256 after every --hash=sha256 in every requirements file", () => {
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] === null) { continue; }
      const text = readFileSync(join(REQUIREMENTS_DIR, `${platform}.txt`), "utf8");
      const hashes = text.match(/--hash=\S+/g) ?? [];
      expect(hashes.length).toBeGreaterThan(0);
      for (const hash of hashes) { expect(hash).toMatch(/^--hash=sha256:[0-9a-f]{64}$/); }
    }
  });

  it("4.1b has no requirements file for a platform that the pin marks null", () => {
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] === null) {
        expect(existsSync(join(REQUIREMENTS_DIR, `${platform}.txt`))).toBe(false);
      }
    }
  });

  it("4.1b lists weights, each with a file, an https url and a 64-hex sha256", () => {
    expect(REAL_PIN.weights.length).toBeGreaterThan(0);
    for (const weight of REAL_PIN.weights) {
      expect(weight.file.length).toBeGreaterThan(0);
      expect(weight.url).toMatch(/^https:\/\//);
      expect(weight.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("4.1b maps node platform and architecture to a pin platform", () => {
    expect(pix2texPlatform("darwin", "arm64")).toBe("darwin-arm64");
    expect(pix2texPlatform("darwin", "x64")).toBe("darwin-x64");
    expect(pix2texPlatform("win32", "x64")).toBe("win32-x64");
    expect(pix2texPlatform("linux", "x64")).toBe("linux-x64");
    expect(pix2texPlatform("linux", "arm64")).toBe("linux-arm64");
  });

  it("4.1b maps an unknown platform or architecture to undefined", () => {
    expect(pix2texPlatform("win32", "arm64")).toBeUndefined();
    expect(pix2texPlatform("freebsd", "x64")).toBeUndefined();
    expect(pix2texPlatform("linux", "ia32")).toBeUndefined();
  });

  it("4.1b has a contract section managed-tools#pix2tex that names the pin version, every supported platform and every weight file", () => {
    const repo = resolve(__dirname, "../../../../..");
    const section = execFileSync("node", ["scripts/docs/doc.mjs", "contracts/managed-tools#pix2tex"], { cwd: repo, encoding: "utf8" });
    expect(section).toContain(REAL_PIN.version);
    for (const platform of ALL_PLATFORMS) {
      if (REAL_PIN.platforms[platform] !== null) { expect(section).toContain(platform); }
    }
    for (const weight of REAL_PIN.weights) { expect(section).toContain(weight.file); }
  });
});

// ---- A8 ---------------------------------------------------------------------------------------

describe("managed pix2tex A8", () => {
  it("A8 verifies every weight through the download with the pinned sha256 and installs nothing when one fails", async () => {
    const fx = await makeFixture();
    fx.failDownload.url = mockPin.weights[0]?.url ?? null;
    await expect(fx.provider.install(onProgress(fx))).rejects.toBeDefined();
    expect(fx.downloads[0]).toEqual({ url: mockPin.weights[0]?.url, sha256: mockPin.weights[0]?.sha256 });
    await assertNothingInstalled(fx);
  });

  it("A8 runs pip with --require-hashes and under the lock", async () => {
    const fx = await makeFixture();
    await fx.provider.install(onProgress(fx));
    expect(fx.runs[1]?.args).toContain("--require-hashes");
    expect(fx.calls.find((call) => call.kind === "pip")?.lock).toBe(true);
  });
});
