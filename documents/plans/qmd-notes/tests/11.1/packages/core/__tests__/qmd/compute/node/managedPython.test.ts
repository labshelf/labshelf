// Tests the shared managed Python provider: status, install from fixture archives, the hash check and the shared tools lock.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const ARCHIVE_URL = "https://example.test/python-build-standalone/cpython-3.12.7-install_only.tar.gz";
const SYMPY_URL = "https://example.test/wheels/sympy-1.13.3-py3-none-any.whl";
const MPMATH_URL = "https://example.test/wheels/mpmath-1.3.0-py3-none-any.whl";

// jest.mock is hoisted above the imports; the factory runs lazily, after this object exists.
const mockPin = {
  release: "20241016",
  version: "3.12.7",
  archives: {} as Record<string, { url: string; sha256: string }>,
  wheels: {
    sympy: { version: "1.13.3", url: SYMPY_URL, sha256: "" },
    mpmath: { version: "1.3.0", url: MPMATH_URL, sha256: "" },
  },
};

jest.mock("../../../../src/qmd/compute/pythonPin", () => ({ PYTHON_PIN: mockPin }));

import type { ILogger } from "../../../../src/ports/index";
import { resolveSharedToolsDir, withToolLock } from "../../../../src/latex/node/managedTex";
import { createSharedPythonProvider, type PythonProvider } from "../../../../src/qmd/compute/node/managedPython";

// ---- fixtures ----------------------------------------------------------------------------------

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) { c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) { c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8); }
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with stored (uncompressed) entries, which is all a wheel fixture needs. */
function makeZip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function makeWheel(name: string, version: string): Buffer {
  return makeZip({
    [`${name}/__init__.py`]: `__version__ = "${version}"\n`,
    [`${name}-${version}.dist-info/METADATA`]: `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`,
    [`${name}-${version}.dist-info/RECORD`]: "",
  });
}

/**
 * An install_only style archive: one top directory holding a python executable under bin and a site-packages folder.
 * The spec leaves the exact folder names open, so the tree offers the plausible ones side by side.
 */
async function makePythonArchive(work: string): Promise<Buffer> {
  const tree = join(work, "archive-tree");
  const top = join(tree, "python");
  const dirs = [
    "bin/x64", "bin/x86_64-linux", "bin/linux-x64",
    "site-packages", "lib/python3.12/site-packages", "Lib/site-packages",
  ];
  for (const dir of dirs) {
    await mkdir(join(top, dir), { recursive: true });
    await writeFile(join(top, dir, ".keep"), "");
  }
  for (const arch of ["x64", "x86_64-linux", "linux-x64"]) {
    for (const exe of ["python", "python.exe"]) {
      await writeFile(join(top, "bin", arch, exe), "#!/bin/sh\n");
      await chmod(join(top, "bin", arch, exe), 0o755);
    }
  }
  for (const exe of ["python", "python3", "python.exe"]) {
    await writeFile(join(top, "bin", exe), "#!/bin/sh\n");
    await chmod(join(top, "bin", exe), 0o755);
  }
  const out = join(work, "python.tar.gz");
  await run("tar", ["-czf", out, "-C", tree, "python"]);
  return (await import("node:fs/promises")).readFile(out);
}

async function listFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { found.push(...await listFiles(full)); } else { found.push(full); }
  }
  return found;
}

interface Fixture {
  home: string;
  root: string;
  fetched: string[];
  logger: { log: jest.Mock; error: jest.Mock };
  served: Map<string, Buffer>;
  provider(): PythonProvider;
  cleanup(): Promise<void>;
}

async function createFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "labshelf-python-"));
  const env: NodeJS.ProcessEnv = { XDG_DATA_HOME: join(home, "data"), LOCALAPPDATA: join(home, "local") };
  const platform: NodeJS.Platform = "linux";
  const root = join(resolveSharedToolsDir(env, platform, home), "python");
  const archive = await makePythonArchive(home);
  const served = new Map<string, Buffer>([
    [ARCHIVE_URL, archive],
    [SYMPY_URL, makeWheel("sympy", "1.13.3")],
    [MPMATH_URL, makeWheel("mpmath", "1.3.0")],
  ]);
  const archiveEntry = { url: ARCHIVE_URL, sha256: sha256(archive) };
  mockPin.archives = Object.fromEntries(
    ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"].map((key) => [key, { ...archiveEntry }]),
  );
  mockPin.wheels.sympy.sha256 = sha256(served.get(SYMPY_URL) as Buffer);
  mockPin.wheels.mpmath.sha256 = sha256(served.get(MPMATH_URL) as Buffer);
  const fetched: string[] = [];
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  const fetchImpl = async (url: string): Promise<Response> => {
    fetched.push(url);
    const bytes = served.get(url);
    return bytes ? new Response(new Uint8Array(bytes), { status: 200 }) : new Response("not found", { status: 404 });
  };
  return {
    home, root, fetched, logger, served,
    provider: () => createSharedPythonProvider({ env, platform, homeDir: home, logger: logger as unknown as ILogger, fetchImpl }),
    cleanup: () => rm(home, { recursive: true, force: true }),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves with the value, or with "timeout" when the promise is still pending after `ms`. */
const orTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> =>
  Promise.race([promise, delay(ms).then(() => "timeout" as const)]);

const INSTALLED = { state: "installed", version: "3.12.7", sympy: "1.13.3" };

let fx: Fixture;
beforeEach(async () => { fx = await createFixture(); });
afterEach(() => fx.cleanup());

// ---- 11.1a -------------------------------------------------------------------------------------

describe("createSharedPythonProvider install", () => {
  it("11.1a reports missing before anything is installed", async () => {
    expect(await fx.provider().status()).toEqual({ state: "missing" });
  });

  it("11.1a installs from the fixture archives into the shared root and reports installed with version and sympy", async () => {
    const status = await fx.provider().install();
    expect(status).toEqual(INSTALLED);
  });

  it("11.1a reports the same installed status from a fresh provider on the same root", async () => {
    await fx.provider().install();
    expect(await fx.provider().status()).toEqual(INSTALLED);
  });

  it("11.1a puts the interpreter under python/bin/<arch> of the shared tools folder", async () => {
    await fx.provider().install();
    const files = (await listFiles(join(fx.root, "bin"))).map((file) => file.slice(fx.root.length + 1));
    expect(files.some((file) => /^bin\/[^/]+\/python(\.exe)?$/.test(file))).toBe(true);
  });

  it("11.1a unpacks the sympy and mpmath wheels into site-packages", async () => {
    await fx.provider().install();
    const files = await listFiles(fx.root);
    expect(files.some((file) => /site-packages\/sympy\/__init__\.py$/.test(file))).toBe(true);
    expect(files.some((file) => /site-packages\/mpmath\/__init__\.py$/.test(file))).toBe(true);
  });

  it("11.1a leaves no staging folder behind", async () => {
    await fx.provider().install();
    expect((await readdir(fx.root)).filter((name) => name.startsWith(".staging"))).toEqual([]);
  });

  it("11.1a requests only the pinned archive and wheel urls", async () => {
    await fx.provider().install();
    expect(new Set(fx.fetched)).toEqual(new Set([ARCHIVE_URL, SYMPY_URL, MPMATH_URL]));
  });

  it("11.1a keeps working when installed again over an existing install", async () => {
    await fx.provider().install();
    expect(await fx.provider().install()).toEqual(INSTALLED);
  });

  it("11.1a passes progress fractions between 0 and 1 to the callback", async () => {
    const fractions: number[] = [];
    await fx.provider().install((_message, fraction) => { if (fraction !== undefined) { fractions.push(fraction); } });
    expect(fractions.every((fraction) => fraction >= 0 && fraction <= 1)).toBe(true);
  });
});

// ---- 11.1b -------------------------------------------------------------------------------------

describe("createSharedPythonProvider hash check", () => {
  const entries = async (root: string) => (existsSync(root) ? (await readdir(root)).filter((name) => name !== ".lock") : []);

  it("11.1b rejects an archive whose SHA-256 differs from the pin and leaves no folder", async () => {
    for (const key of Object.keys(mockPin.archives)) {
      mockPin.archives[key] = { url: ARCHIVE_URL, sha256: sha256(Buffer.from("something else")) };
    }
    await expect(fx.provider().install()).rejects.toThrow(/checksum|sha-?256|mismatch/i);
    expect(await entries(fx.root)).toEqual([]);
  });

  it("11.1b reports missing after a failed archive check", async () => {
    for (const key of Object.keys(mockPin.archives)) {
      mockPin.archives[key] = { url: ARCHIVE_URL, sha256: sha256(Buffer.from("something else")) };
    }
    await fx.provider().install().catch(() => undefined);
    expect(await fx.provider().status()).toEqual({ state: "missing" });
  });

  it("11.1b rejects a wheel whose SHA-256 differs from the pin and leaves no folder", async () => {
    mockPin.wheels.sympy.sha256 = sha256(Buffer.from("something else"));
    await expect(fx.provider().install()).rejects.toThrow(/checksum|sha-?256|mismatch/i);
    expect(await entries(fx.root)).toEqual([]);
  });

  it("11.1b does not touch an existing install when the new download fails the check", async () => {
    await fx.provider().install();
    mockPin.wheels.mpmath.sha256 = sha256(Buffer.from("something else"));
    await expect(fx.provider().install()).rejects.toThrow();
    expect(await fx.provider().status()).toEqual(INSTALLED);
  });
});

// ---- 11.1c -------------------------------------------------------------------------------------

describe("createSharedPythonProvider lock", () => {
  it("11.1c installs once when two providers install at the same time", async () => {
    const [first, second] = await Promise.all([fx.provider().install(), fx.provider().install()]);
    expect(first).toEqual(INSTALLED);
    expect(second).toEqual(INSTALLED);
    expect(fx.fetched.filter((url) => url === ARCHIVE_URL)).toHaveLength(1);
    expect(fx.fetched.filter((url) => url === SYMPY_URL)).toHaveLength(1);
  });

  it("11.1c waits for a lock held by another operation before downloading anything", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let locked: () => void = () => undefined;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const holder = withToolLock(fx.root, "other install", fx.logger as unknown as ILogger, async () => { locked(); await held; });
    await acquired;
    const install = fx.provider().install();
    expect(await orTimeout(install, 300)).toBe("timeout");
    expect(fx.fetched).toEqual([]);
    release();
    await holder;
    expect(await install).toEqual(INSTALLED);
  });

  it("11.1c releases the lock once the install is done", async () => {
    await fx.provider().install();
    expect(existsSync(join(fx.root, ".lock"))).toBe(false);
  });

  it("11.1c releases the lock when the install fails", async () => {
    mockPin.wheels.sympy.sha256 = sha256(Buffer.from("something else"));
    await fx.provider().install().catch(() => undefined);
    expect(existsSync(join(fx.root, ".lock"))).toBe(false);
  });
});

// ---- 11.1d -------------------------------------------------------------------------------------

describe("createSharedPythonProvider status", () => {
  const holding = <T>(run: () => Promise<T>): Promise<T> =>
    withToolLock(fx.root, "other install", fx.logger as unknown as ILogger, run);

  it("11.1d reads missing while another process holds the lock", async () => {
    const result = await holding(() => orTimeout(fx.provider().status(), 2000));
    expect(result).toEqual({ state: "missing" });
  });

  it("11.1d reads installed while another process holds the lock", async () => {
    await fx.provider().install();
    const result = await holding(() => orTimeout(fx.provider().status(), 2000));
    expect(result).toEqual(INSTALLED);
  });

  it("11.1d creates nothing on disk when it reads", async () => {
    await fx.provider().status();
    expect(existsSync(fx.root)).toBe(false);
  });
});
