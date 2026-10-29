// Installs the pinned Python into the managed folder: verified downloads, a staged tree with the wheels unzipped into it, and the swap into place.
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { FetchLike, ILogger } from "../../../ports/index.js";
import { downloadVerified, extractArchive, findSingleTopDir, removeQuarantine, withStagingDir, type RunFile } from "../../../latex/node/index.js";
import type { PythonPin } from "../pythonPin.js";

export const PIN_FILE = ".pin.json";
const MODULE = "ManagedPython";

export interface PythonInstallRun {
  root: string;
  platform: NodeJS.Platform;
  pin: PythonPin;
  archive: { url: string; sha256: string };
  /** The site-packages folder inside a tree laid out like `<root>`. */
  sitePackagesIn: (tree: string) => string;
  logger: ILogger;
  fetchImpl: FetchLike;
  execFileImpl?: RunFile | undefined;
  report: (message: string, fraction: number) => void;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const NO_ZIP64 = 0xffffffff;

interface ZipEntry { name: string; method: number; compressed: number; size: number; offset: number }

function readEntries(zip: Buffer): ZipEntry[] {
  let eocd = -1;
  for (let at = zip.length - 22; at >= Math.max(0, zip.length - 22 - 0xffff); at -= 1) {
    if (zip.readUInt32LE(at) === EOCD) { eocd = at; break; }
  }
  if (eocd < 0) { throw new Error("Not a zip file: no end-of-central-directory record"); }
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > zip.length || zip.readUInt32LE(at) !== CENTRAL) { throw new Error("Corrupt zip central directory"); }
    const nameLength = zip.readUInt16LE(at + 28);
    const entry = {
      name: zip.toString("utf8", at + 46, at + 46 + nameLength),
      method: zip.readUInt16LE(at + 10),
      compressed: zip.readUInt32LE(at + 20),
      size: zip.readUInt32LE(at + 24),
      offset: zip.readUInt32LE(at + 42),
    };
    if (entry.compressed === NO_ZIP64 || entry.size === NO_ZIP64 || entry.offset === NO_ZIP64) { throw new Error(`Zip64 entry ${entry.name} is not supported`); }
    entries.push(entry);
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return entries;
}

function entryBytes(zip: Buffer, entry: ZipEntry): Buffer {
  const header = entry.offset;
  if (header + 30 > zip.length || zip.readUInt32LE(header) !== LOCAL) { throw new Error(`Corrupt zip entry ${entry.name}`); }
  const start = header + 30 + zip.readUInt16LE(header + 26) + zip.readUInt16LE(header + 28);
  const raw = zip.subarray(start, start + entry.compressed);
  if (entry.method !== 0 && entry.method !== 8) { throw new Error(`Zip entry ${entry.name} uses unsupported compression method ${entry.method}`); }
  const bytes = entry.method === 8 ? inflateRawSync(raw) : raw;
  if (bytes.length !== entry.size) { throw new Error(`Zip entry ${entry.name} has the wrong size`); }
  return bytes;
}

/** Unzips a wheel into `destination` without external tools; rejects entries that would land outside it. */
async function unzipWheel(zip: Buffer, destination: string): Promise<void> {
  for (const entry of readEntries(zip)) {
    const parts = entry.name.split(/[\\/]/);
    if (isAbsolute(entry.name) || /^[A-Za-z]:/.test(entry.name) || entry.name.startsWith("/") || entry.name.startsWith("\\") || parts.includes("..")) {
      throw new Error(`Unsafe path in wheel: ${entry.name}`);
    }
    const target = resolve(destination, ...parts);
    if (!target.startsWith(resolve(destination) + sep)) { throw new Error(`Unsafe path in wheel: ${entry.name}`); }
    if (entry.name.endsWith("/")) {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entryBytes(zip, entry));
  }
}

async function swapIn(root: string, top: string, pinText: string): Promise<void> {
  for (const name of await readdir(root)) {
    if (name === ".lock" || name.startsWith(".staging-")) { continue; }
    await rm(join(root, name), { recursive: true, force: true });
  }
  for (const name of await readdir(top)) { await rename(join(top, name), join(root, name)); }
  await writeFile(join(root, PIN_FILE), pinText);
}

/** Downloads and verifies everything first, then replaces the contents of `run.root`; a failure before the swap changes nothing. */
export async function installPythonTree(run: PythonInstallRun, pinText: string): Promise<void> {
  const { root, pin, logger, fetchImpl, report } = run;
  await logger.log("INFO", MODULE, "Downloading Python", { url: run.archive.url, version: pin.version });
  report("Downloading Python", 0);
  const archiveBytes = await downloadVerified(run.archive.url, run.archive.sha256, fetchImpl);
  report("Downloading SymPy", 0.5);
  const sympy = await downloadVerified(pin.wheels.sympy.url, pin.wheels.sympy.sha256, fetchImpl);
  report("Downloading mpmath", 0.6);
  const mpmath = await downloadVerified(pin.wheels.mpmath.url, pin.wheels.mpmath.sha256, fetchImpl);
  await logger.log("INFO", MODULE, "Python downloads verified", { archiveBytes: archiveBytes.length, sympy: sympy.length, mpmath: mpmath.length });
  await withStagingDir(root, "python", async (staging) => {
    const tree = join(staging, "tree");
    const archive = join(staging, "python.tar.gz");
    await mkdir(tree);
    await writeFile(archive, archiveBytes);
    report("Unpacking Python", 0.7);
    await extractArchive(archive, "tar.gz", tree);
    const top = await findSingleTopDir(tree);
    report("Installing SymPy and mpmath", 0.85);
    const sitePackages = run.sitePackagesIn(top);
    await mkdir(sitePackages, { recursive: true });
    await unzipWheel(mpmath, sitePackages);
    await unzipWheel(sympy, sitePackages);
    report("Finishing the Python install", 0.95);
    // INVARIANT: the old install goes only after the new tree is unpacked and complete.
    await swapIn(root, top, pinText);
  });
  if (run.platform === "darwin") { await removeQuarantine(root, logger, run.execFileImpl); }
  await logger.log("INFO", MODULE, "Python installed", { root, version: pin.version, sympy: pin.wheels.sympy.version });
  report("Python installed", 1);
}
