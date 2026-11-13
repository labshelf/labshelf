// Contract of the managed pix2tex install: the staged install of python, venv, pip and weights under the tool lock.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ILogger } from "../../../src/ports/index.js";
import { withToolLock } from "../../../src/latex/node/managedTex.js";
import { WEIGHTS_BYTES, RESIZER_BYTES, mockPin, BASE_PYTHON, Fixture, names, makeFixture, onProgress, assertNothingInstalled, removeTmpDirs } from "./installPix2texHarness.js";

afterEach(removeTmpDirs);

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
