// Hidden tests of spec 4.2: the managed chrome-headless-shell provider over a temp tools folder, an injected pin and fetch, and the tools lock.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ChromiumPin } from "../../../src/decks/node/chromiumPin.js";
import { createManagedChromiumProvider, type ManagedChromiumProvider } from "../../../src/decks/node/managedChromium.js";
import { withToolLock } from "../../../src/latex/node/index.js";
import type { ILogger } from "../../../src/ports/index.js";

jest.setTimeout(30_000);

const run = promisify(execFile);

const VERSION = "131.0.6778.204";
const URL = "https://example.test/chrome-for-testing-public/chrome-headless-shell-test.zip";
const TOP = "chrome-headless-shell-test";
const EXEC = `${TOP}/chrome-headless-shell${process.platform === "win32" ? ".exe" : ""}`;
const KEY = `${process.platform}-${process.arch}`;

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A zip made by the zip CLI from `files` (path inside the zip -> text), written under a fresh folder of `work`. */
async function makeZip(work: string, files: Record<string, string>): Promise<Buffer> {
  const tree = await mkdtemp(join(work, "tree-"));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(tree, name, ".."), { recursive: true });
    await writeFile(join(tree, name), text);
    // Not executable in the archive, so the install's chmod is observable.
    await chmod(join(tree, name), 0o644);
  }
  const out = join(work, `${Object.keys(files).length}-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const tops = [...new Set(Object.keys(files).map((name) => name.split("/")[0] as string))];
  await run("zip", ["-q", "-r", out, ...tops], { cwd: tree });
  return readFile(out);
}

function pinFor(bytes: Buffer, overrides: Partial<{ sha256: string; executable: string }> = {}): ChromiumPin {
  const entry = { url: URL, sha256: overrides.sha256 ?? sha256(bytes), executable: overrides.executable ?? EXEC };
  const platforms = { "darwin-arm64": entry, "darwin-x64": entry, "linux-x64": entry, "win32-x64": entry, [KEY]: entry };
  return { version: VERSION, platforms } as ChromiumPin;
}

interface Fixture {
  toolsDir: string;
  chromeDir: string;
  work: string;
  fetched: string[];
  served: Map<string, Buffer>;
  /** When set, each fetch awaits it before answering. */
  gate: { before?: (url: string) => Promise<void> };
  logger: ILogger;
  provider(pin: ChromiumPin, platform?: NodeJS.Platform, arch?: string): ManagedChromiumProvider;
}

let fx: Fixture;

beforeEach(async () => {
  const toolsDir = await mkdtemp(join(tmpdir(), "labshelf-chrome-tools-"));
  const work = await mkdtemp(join(tmpdir(), "labshelf-chrome-work-"));
  const fetched: string[] = [];
  const served = new Map<string, Buffer>();
  const gate: Fixture["gate"] = {};
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
  const fetchImpl = async (url: string): Promise<Response> => {
    fetched.push(url);
    if (gate.before) { await gate.before(url); }
    const bytes = served.get(url);
    return bytes ? new Response(new Uint8Array(bytes), { status: 200 }) : new Response("not found", { status: 404 });
  };
  fx = {
    toolsDir, chromeDir: join(toolsDir, "chrome"), work, fetched, served, gate, logger,
    provider: (pin, platform = process.platform, arch = process.arch) =>
      createManagedChromiumProvider({ toolsDir, platform, arch, logger, fetchImpl, pin }),
  };
});

afterEach(async () => {
  await rm(fx.toolsDir, { recursive: true, force: true });
  await rm(fx.work, { recursive: true, force: true });
});

async function servedChrome(extra: Record<string, string> = {}): Promise<Buffer> {
  const bytes = await makeZip(fx.work, { [EXEC]: "#!/bin/sh\necho headless\n", [`${TOP}/resources.pak`]: "pak", ...extra });
  fx.served.set(URL, bytes);
  return bytes;
}

const installedExecutable = (): string => join(fx.chromeDir, VERSION, EXEC);
const pinFile = (): string => join(fx.chromeDir, "chrome-pin.json");
const stagingLeft = async (): Promise<string[]> =>
  existsSync(fx.chromeDir) ? (await readdir(fx.chromeDir)).filter((name) => name.startsWith(".staging")) : [];

// ---- 4.2b ----------------------------------------------------------------------------------------

describe("createManagedChromiumProvider install", () => {
  it("4.2b reports not installed before any install", async () => {
    const bytes = await servedChrome();
    expect((await fx.provider(pinFor(bytes)).status()).installed).toBe(false);
  });

  it("4.2b resolves the absolute executable inside chrome/<version>", async () => {
    const bytes = await servedChrome();
    const path = await fx.provider(pinFor(bytes)).install();
    expect(path).toBe(installedExecutable());
    expect(existsSync(installedExecutable())).toBe(true);
    expect(existsSync(join(fx.chromeDir, VERSION, TOP, "resources.pak"))).toBe(true);
  });

  it("4.2b downloads the pinned url once", async () => {
    const bytes = await servedChrome();
    await fx.provider(pinFor(bytes)).install();
    expect(fx.fetched).toEqual([URL]);
  });

  it("4.2b writes chrome-pin.json with the version and sha256", async () => {
    const bytes = await servedChrome();
    await fx.provider(pinFor(bytes)).install();
    expect(JSON.parse(await readFile(pinFile(), "utf8"))).toEqual({ version: VERSION, sha256: sha256(bytes) });
  });

  it("4.2b writes chrome-pin.json only after unpacking", async () => {
    const bytes = await servedChrome();
    const pinSeen: Record<string, boolean> = {};
    await fx.provider(pinFor(bytes)).install((message) => { pinSeen[message] = existsSync(pinFile()); });
    expect(pinSeen["Unpacking"]).toBe(false);
    expect(existsSync(pinFile())).toBe(true);
  });

  it("4.2b reports Downloading, Unpacking and Done in order", async () => {
    const bytes = await servedChrome();
    const messages: string[] = [];
    await fx.provider(pinFor(bytes)).install((message) => messages.push(message));
    expect(messages).toEqual([`Downloading chrome-headless-shell ${VERSION}`, "Unpacking", "Done"]);
  });

  it("4.2b status reports installed with the version and the absolute executable", async () => {
    const bytes = await servedChrome();
    const provider = fx.provider(pinFor(bytes));
    await provider.install();
    expect(await provider.status()).toEqual({ installed: true, version: VERSION, executable: installedExecutable() });
  });

  it("4.2b leaves no staging folder after an install", async () => {
    const bytes = await servedChrome();
    await fx.provider(pinFor(bytes)).install();
    expect(await stagingLeft()).toEqual([]);
  });

  it("4.2b makes the executable executable off Windows", async () => {
    if (process.platform === "win32") { return; }
    const bytes = await servedChrome();
    await fx.provider(pinFor(bytes)).install();
    expect((await stat(installedExecutable())).mode & 0o777).toBe(0o755);
  });

  it("4.2b replaces an older chrome/<version> folder", async () => {
    const bytes = await servedChrome();
    await mkdir(join(fx.chromeDir, VERSION), { recursive: true });
    await writeFile(join(fx.chromeDir, VERSION, "stale.txt"), "old");
    await fx.provider(pinFor(bytes)).install();
    expect(existsSync(join(fx.chromeDir, VERSION, "stale.txt"))).toBe(false);
    expect(existsSync(installedExecutable())).toBe(true);
  });

  it("4.2b status reads installed from chrome-pin.json and the executable alone", async () => {
    const bytes = await servedChrome();
    await mkdir(join(fx.chromeDir, VERSION, TOP), { recursive: true });
    await writeFile(installedExecutable(), "#!/bin/sh\n");
    await writeFile(pinFile(), JSON.stringify({ version: VERSION, sha256: sha256(bytes) }));
    expect(await fx.provider(pinFor(bytes)).status()).toEqual({ installed: true, version: VERSION, executable: installedExecutable() });
  });

  it("4.2b status reports not installed when chrome-pin.json names another version", async () => {
    const bytes = await servedChrome();
    await mkdir(join(fx.chromeDir, VERSION, TOP), { recursive: true });
    await writeFile(installedExecutable(), "#!/bin/sh\n");
    await writeFile(pinFile(), JSON.stringify({ version: "120.0.0.0", sha256: sha256(bytes) }));
    expect((await fx.provider(pinFor(bytes)).status()).installed).toBe(false);
  });

  it("4.2b status reports not installed when the executable is missing", async () => {
    const bytes = await servedChrome();
    await mkdir(join(fx.chromeDir, VERSION), { recursive: true });
    await writeFile(pinFile(), JSON.stringify({ version: VERSION, sha256: sha256(bytes) }));
    expect((await fx.provider(pinFor(bytes)).status()).installed).toBe(false);
  });
});

// ---- 4.2c ----------------------------------------------------------------------------------------

describe("createManagedChromiumProvider failures", () => {
  const nothingInstalled = async (provider: ManagedChromiumProvider): Promise<void> => {
    expect(existsSync(join(fx.chromeDir, VERSION))).toBe(false);
    expect(existsSync(pinFile())).toBe(false);
    expect(await stagingLeft()).toEqual([]);
    expect((await provider.status()).installed).toBe(false);
  };

  it("4.2c rejects a download whose SHA-256 differs from the pin and installs nothing", async () => {
    await servedChrome();
    const provider = fx.provider(pinFor(Buffer.alloc(0), { sha256: sha256(Buffer.from("something else")) }));
    await expect(provider.install()).rejects.toThrow(/Checksum mismatch/);
    await nothingInstalled(provider);
  });

  it("4.2c rejects an archive without the pinned executable and installs nothing", async () => {
    const bytes = await makeZip(fx.work, { [`${TOP}/other-binary`]: "#!/bin/sh\n" });
    fx.served.set(URL, bytes);
    const provider = fx.provider(pinFor(bytes));
    await expect(provider.install()).rejects.toThrow(`The chrome-headless-shell archive has no ${EXEC}.`);
    await nothingInstalled(provider);
  });

  it("4.2c rejects a platform without a pin entry before downloading", async () => {
    const bytes = await servedChrome();
    const pin = pinFor(bytes);
    const platforms = { ...pin.platforms } as Record<string, unknown>;
    delete platforms["linux-arm64"];
    const provider = fx.provider({ version: VERSION, platforms } as ChromiumPin, "linux", "arm64");
    await expect(provider.install()).rejects.toThrow("chrome-headless-shell has no build for linux-arm64.");
    expect(fx.fetched).toEqual([]);
    await nothingInstalled(provider);
  });
});

// ---- 4.2d ----------------------------------------------------------------------------------------

describe("createManagedChromiumProvider lock", () => {
  it("4.2d holds <toolsDir>/.lock while it downloads and releases it after", async () => {
    const bytes = await servedChrome();
    const lockSeen: boolean[] = [];
    fx.gate.before = async () => { lockSeen.push(existsSync(join(fx.toolsDir, ".lock"))); };
    await fx.provider(pinFor(bytes)).install();
    expect(lockSeen).toEqual([true]);
    expect(existsSync(join(fx.toolsDir, ".lock"))).toBe(false);
  });

  it("4.2d releases the lock when the install fails", async () => {
    await servedChrome();
    await fx.provider(pinFor(Buffer.alloc(0), { sha256: sha256(Buffer.from("something else")) })).install().catch(() => undefined);
    expect(existsSync(join(fx.toolsDir, ".lock"))).toBe(false);
  });

  it("4.2d does not download while another operation holds the tools lock", async () => {
    const bytes = await servedChrome();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked: () => void = () => undefined;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const holder = withToolLock(fx.toolsDir, "other install", fx.logger, async () => { locked(); await held; });
    await acquired;
    const install = fx.provider(pinFor(bytes)).install();
    await delay(1200);
    expect(fx.fetched).toEqual([]);
    release();
    await holder;
    expect(await install).toBe(installedExecutable());
  });

  it("4.2d makes a second concurrent install wait until the first is done", async () => {
    const bytes = await servedChrome();
    const events: string[] = [];
    let openGate: () => void = () => undefined;
    const gateOpen = new Promise<void>((resolve) => { openGate = resolve; });
    let firstFetch: () => void = () => undefined;
    const fetchedOnce = new Promise<void>((resolve) => { firstFetch = resolve; });
    const pinAtFetch: boolean[] = [];
    fx.gate.before = async () => {
      pinAtFetch.push(existsSync(pinFile()));
      events.push("fetch");
      if (events.filter((event) => event === "fetch").length === 1) { firstFetch(); await gateOpen; }
    };
    const pin = pinFor(bytes);
    const first = fx.provider(pin).install((message) => events.push(`a:${message}`));
    const second = fx.provider(pin).install((message) => events.push(`b:${message}`));
    await fetchedOnce;
    // Longer than two lock polls: a second install outside the lock would have fetched by now.
    await delay(1200);
    expect(fx.fetched).toEqual([URL]);
    openGate();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(installedExecutable());
    expect(b).toBe(installedExecutable());
    // The first install found nothing; a second download, if any, starts only after the first wrote chrome-pin.json.
    expect(pinAtFetch[0]).toBe(false);
    expect(pinAtFetch.slice(1)).toEqual(pinAtFetch.slice(1).map(() => true));
    expect(await fx.provider(pin).status()).toEqual({ installed: true, version: VERSION, executable: installedExecutable() });
  });
});
