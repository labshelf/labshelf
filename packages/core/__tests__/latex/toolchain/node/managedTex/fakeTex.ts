// Builds fake TinyTeX and signed install-tl archives, a fake download server and a fake system TeX for the managed TeX tests.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ILogger } from "../../../../../src/ports/index.js";
import { armoredSignature, TEST_SIGNING_KEY } from "../fakeOpenPgp";

const run = promisify(execFile);

export const TINYTEX_ASSET = "TinyTeX-1-linux-x86_64-v2026.10.tar.xz";
export const TINYTEX_URL = `https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/${TINYTEX_ASSET}`;
export const INSTALL_TL_URL = "https://mirror.ctan.org/systems/texlive/tlnet/install-tl-unx.tar.gz";
export const INSTALL_TL_MIRROR = "https://mirror.example.org/tlnet/install-tl-unx.tar.gz";

export const ROLLOVER_MESSAGE = [
  "tlmgr: Local TeX Live (2025) is older than remote repository (2026).",
  "Cross release updates are only supported with",
  "  update-tlmgr-latest(.sh/.exe) -- --upgrade",
  "See https://tug.org/texlive/upgrade.html for details.",
].join("\n");

export const STALE_TLMGR_MESSAGE = [
  "tlmgr itself needs to be updated.",
  "Please do this via either",
  "  tlmgr update --self",
].join("\n");

/** `staleSelf`: every repository action fails with the stale-tlmgr message until `update --self` runs. */
export interface FakeTlmgr { rollover: boolean; installed: string[]; staleSelf?: boolean }

/** A node tlmgr that logs every call to `callsFile`, keeps its installed list next to itself and answers `/foo.sty` with `foopkg`. */
export function fakeTlmgrScript(callsFile: string, options: FakeTlmgr): string {
  return `#!${process.execPath}
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const listFile = path.join(__dirname, "installed.json");
if (!fs.existsSync(listFile)) fs.writeFileSync(listFile, ${JSON.stringify(JSON.stringify(options.installed))});
const installed = JSON.parse(fs.readFileSync(listFile, "utf8"));
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ tlmgr: __filename, args }) + "\\n");
const selfFile = path.join(__dirname, "self-updated");
if (args[0] === "info") {
  process.stdout.write(installed.join("\\n") + "\\n");
} else if (args[0] === "update" && args[1] === "--self") {
  fs.writeFileSync(selfFile, "");
} else if (${options.staleSelf ?? false} && !fs.existsSync(selfFile)) {
  process.stderr.write(${JSON.stringify(STALE_TLMGR_MESSAGE)} + "\\n");
  process.exitCode = 255;
} else if (${options.rollover}) {
  process.stderr.write(${JSON.stringify(ROLLOVER_MESSAGE)} + "\\n");
  process.exitCode = 1;
} else {
  console.log("tlmgr: package repository https://mirror.example.org/tlnet (verified)");
  if (args[0] === "search" && args[args.length - 1] === "/foo.sty") console.log("foopkg:\\n\\ttexmf-dist/tex/latex/foo/foo.sty");
  if (args[0] === "install") {
    const pkgs = args.slice(1);
    pkgs.forEach((p, i) => console.log("[" + (i + 1) + "/" + pkgs.length + ", ??:??/??:??] install: " + p + " [1k]"));
    fs.writeFileSync(listFile, JSON.stringify([...installed, ...pkgs]));
  }
}
`;
}

async function writeExecutable(file: string, text: string): Promise<void> {
  await writeFile(file, text);
  await chmod(file, 0o755);
}

/** A TeX tree with tlmgr, latexmk and release-texlive.txt of `year` under `root/bin/x86_64-linux`. */
export async function writeTexTree(root: string, year: number, callsFile: string, tlmgr: FakeTlmgr): Promise<string> {
  const bin = join(root, "bin", "x86_64-linux");
  await mkdir(bin, { recursive: true });
  await writeExecutable(join(bin, "tlmgr"), fakeTlmgrScript(callsFile, tlmgr));
  await writeExecutable(join(bin, "latexmk"), "#!/bin/sh\n");
  await writeFile(join(root, "release-texlive.txt"), `TeX Live (https://tug.org/texlive) version ${year}\n`);
  return bin;
}

async function tarGz(dir: string, entry: string): Promise<Buffer> {
  const archive = join(dir, `${entry.replace(/^\./, "")}.tgz`);
  await run("tar", ["-czf", archive, "-C", dir, entry]);
  return readFile(archive);
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha512(bytes: Buffer): string {
  return createHash("sha512").update(bytes).digest("hex");
}

export interface TexFixture {
  root: string;
  texRoot: string;
  callsFile: string;
  routes: Map<string, Buffer | string>;
  fetchImpl: (url: string) => Promise<Response>;
  logger: { log: jest.Mock; error: jest.Mock };
  /** Every tlmgr call, in order. */
  calls(): Promise<Array<{ tlmgr: string; args: string[] }>>;
  /** Serves a TinyTeX archive whose tree is `.TinyTeX/` and returns its SHA-256. */
  serveTinyTex(year: number, tlmgr: FakeTlmgr): Promise<string>;
  /** Serves an install-tl whose run writes a TeX tree of `year` into the profile's TEXDIR and copies the profile beside `callsFile`. */
  serveInstallTl(year: number, tlmgr: FakeTlmgr): Promise<void>;
  /** Serves `text` as the installer's .sha512, with a .sha512.asc signed by the test key. */
  serveSignedChecksum(text: string): void;
  cleanup(): Promise<void>;
}

function fakeInstallTl(year: number, callsFile: string, tlmgr: FakeTlmgr): string {
  return `#!${process.execPath}
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const profile = fs.readFileSync(args[args.indexOf("--profile") + 1], "utf8");
fs.writeFileSync(${JSON.stringify(`${callsFile}.profile`)}, profile);
fs.appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ tlmgr: "install-tl", args }) + "\\n");
const texdir = /^TEXDIR (.*)$/m.exec(profile)[1];
const bin = path.join(texdir, "bin", "x86_64-linux");
fs.mkdirSync(bin, { recursive: true });
fs.writeFileSync(path.join(bin, "tlmgr"), ${JSON.stringify(fakeTlmgrScript(callsFile, tlmgr))}, { mode: 0o755 });
fs.writeFileSync(path.join(bin, "latexmk"), "#!/bin/sh\\n", { mode: 0o755 });
fs.writeFileSync(path.join(texdir, "release-texlive.txt"), "TeX Live (https://tug.org/texlive) version ${year}\\n");
console.log("[1/2, 00:00/00:00] install: a [1k]");
// A pause keeps the two counters in separate stdout chunks, which the parent reads one at a time.
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
console.log("[2/2, 00:01/00:01] install: b [1k]");
`;
}

function respond(url: string, body: Buffer | string | undefined): Response {
  const response = body === undefined ? new Response("missing", { status: 404 }) : new Response(body as BodyInit);
  Object.defineProperty(response, "url", { value: url });
  return response;
}

export async function createTexFixture(): Promise<TexFixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "labshelf-tex-")));
  const texRoot = join(root, "data", "tex");
  const callsFile = join(root, "calls.jsonl");
  await writeFile(callsFile, "");
  const routes = new Map<string, Buffer | string>();
  let builds = 0;
  const serveSignedChecksum = (text: string): void => {
    routes.set(`${INSTALL_TL_MIRROR}.sha512`, text);
    routes.set(`${INSTALL_TL_MIRROR}.sha512.asc`, armoredSignature(Buffer.from(text), TEST_SIGNING_KEY.privateKey));
  };
  return {
    root, texRoot, callsFile, routes,
    logger: { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) },
    fetchImpl: async (url) => {
      // The mirror redirector sends the installer to a mirror, which also serves its checksum.
      if (url === INSTALL_TL_URL) { return respond(INSTALL_TL_MIRROR, routes.get(INSTALL_TL_MIRROR)); }
      return respond(url, routes.get(url));
    },
    calls: async () => (await readFile(callsFile, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line)),
    async serveTinyTex(year, tlmgr) {
      const dir = join(root, `tinytex-${(builds += 1)}`);
      await writeTexTree(join(dir, ".TinyTeX"), year, callsFile, tlmgr);
      const archive = await tarGz(dir, ".TinyTeX");
      routes.set(TINYTEX_URL, archive);
      return sha256(archive);
    },
    serveSignedChecksum,
    async serveInstallTl(year, tlmgr) {
      const dir = join(root, `install-tl-${(builds += 1)}`);
      await mkdir(join(dir, "install-tl-20261017"), { recursive: true });
      await writeExecutable(join(dir, "install-tl-20261017", "install-tl"), fakeInstallTl(year, callsFile, tlmgr));
      const archive = await tarGz(dir, "install-tl-20261017");
      routes.set(INSTALL_TL_MIRROR, archive);
      serveSignedChecksum(`${sha512(archive)}  install-tl-unx.tar.gz\n`);
    },
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export function asLogger(logger: TexFixture["logger"]): ILogger {
  return logger as unknown as ILogger;
}
