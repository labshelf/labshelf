// Installs TeX Live or TinyTeX into the shared TeX folder in a staging directory and runs its tools: install-tl, tlmgr and the macOS quarantine removal.
import { mkdir, mkdtemp, rm, readdir, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import type { ILogger, FetchLike } from "../../ports/index.js";
import { formatError } from "../../errors/index.js";
import { runCancellable, type RunOutcome } from "../build/node/index.js";
import { findTinyTexFile, type TinyTexFile } from "../toolchain.js";
import { extractArchive, verifyDetachedSignature, downloadVerified } from "./verify.js";
import type { ManagedTexKind } from "./managedTex.js";
import { TEX_LIVE_SIGNING_KEY } from "./texLiveKeyring.js";

export function resolveManagedTexDir(texRoot: string, kind: ManagedTexKind): string {
  return join(texRoot, kind);
}

export interface TexInstallDeps {
  fetchImpl: FetchLike;
  logger: ILogger;
  platform: NodeJS.Platform;
  /** Runs xattr on macOS; tests inject a fake. */
  execFileImpl?: RunFile;
}

export interface TexInstallRun {
  /** The shared TeX folder; `tex/` under resolveSharedToolsDir. */
  texRoot: string;
  /** A fraction in 0..1, or null while the step has no measurable progress. */
  onProgress: (fraction: number | null) => void;
}

/** Calls `step` with an empty directory inside `texRoot`, so the final rename stays on one file system. */
export async function withStagingDir<T>(texRoot: string, prefix: string, step: (staging: string) => Promise<T>): Promise<T> {
  await mkdir(texRoot, { recursive: true });
  const staging = await mkdtemp(join(texRoot, `.staging-${prefix}-`));
  try {
    return await step(staging);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function findSingleTopDir(parent: string): Promise<string> {
  const dirs = (await readdir(parent, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const [only] = dirs;
  if (dirs.length !== 1 || only === undefined) {
    throw new Error(`Expected one directory in the unpacked installer at ${parent}, found ${dirs.map((dir) => dir.name).join(", ") || "none"}`);
  }
  return join(parent, only.name);
}

export const TEX_MODULE = "tex";

export interface TexToolRun {
  executable: string;
  args: string[];
  cwd: string;
  logger: ILogger;
  /** Receives the fraction (0..1) of the latest `[n/total, …]` line. */
  onProgress?: ((fraction: number) => void) | undefined;
}

const PROGRESS = /\[(\d+)\/(\d+),/g;

/** The fraction of the last `[n/total,` counter in `chunk`, or null when it has none. */
export function deriveProgressFraction(chunk: string): number | null {
  const last = [...chunk.matchAll(PROGRESS)].pop();
  if (!last) { return null; }
  const total = Number(last[2]);
  return total > 0 ? Number(last[1]) / total : null;
}

function quote(part: string): string {
  return `"${part.replace(/"/g, '""')}"`;
}

export async function runTexTool(run: TexToolRun): Promise<RunOutcome> {
  // PLATFORM: on Windows tlmgr and install-tl are .bat files, which only a shell can start.
  const shell = process.platform === "win32";
  const executable = shell ? [run.executable, ...run.args].map(quote).join(" ") : run.executable;
  const onOutput = (chunk: string): void => {
    const fraction = run.onProgress ? deriveProgressFraction(chunk) : null;
    if (fraction !== null) { run.onProgress?.(fraction); }
  };
  await run.logger.log("INFO", TEX_MODULE, "Running a TeX tool", { executable: run.executable, args: run.args });
  const outcome = await runCancellable(executable, shell ? [] : run.args, run.cwd, new AbortController().signal, { shell, onOutput });
  await run.logger.log(outcome.code === 0 ? "INFO" : "WARN", TEX_MODULE, "A TeX tool exited", {
    executable: run.executable, args: run.args, code: outcome.code, ...(outcome.code === 0 ? {} : { output: outcome.output.slice(-2000) }),
  });
  return outcome;
}

const MODULE = "ClearQuarantine";
const execFileAsync = promisify(execFile);

export type RunFile = (file: string, args: string[]) => Promise<unknown>;

/**
 * PLATFORM: a helper launched by a browser writes files that inherit com.apple.quarantine; macOS then
 * SIGKILLs the quarantined binaries at exec (exit 137). A failure is logged, not thrown: the tools may still run.
 */
export async function removeQuarantine(dir: string, logger: ILogger, exec: RunFile = execFileAsync): Promise<void> {
  try {
    await exec("/usr/bin/xattr", ["-dr", "com.apple.quarantine", dir]);
    await logger.log("INFO", MODULE, "Removed the quarantine attribute", { dir });
  } catch (error) {
    // TRAP: xattr exits non-zero with "No such xattr" when nothing is quarantined, the normal case.
    if (String((error as { stderr?: unknown }).stderr ?? error).includes("No such xattr")) { return; }
    await logger.error(MODULE, error, { step: "remove the quarantine attribute", dir });
  }
}

export class TlmgrError extends Error {
  constructor(readonly args: string[], readonly code: number | null, readonly output: string) {
    super(`tlmgr ${args.join(" ")} exited with ${code}`);
    this.name = "TlmgrError";
  }
}

export interface Tlmgr {
  /** The package that provides `deriveFileName`, or null when no package does. */
  searchFile(fileName: string): Promise<string | null>;
  install(packages: string[], onProgress?: (fraction: number) => void): Promise<void>;
  listInstalled(): Promise<string[]>;
}

// TRAP: tlmgr refuses every repository action once CTAN moves to the next TeX Live release.
const ROLLOVER = /is older than remote repository/;

export function isRollover(output: string): boolean {
  return ROLLOVER.test(output);
}

// TRAP: a TinyTeX release can ship a tlmgr older than its repository expects; tlmgr then refuses every repository action until it updates itself.
const STALE_SELF = /tlmgr itself needs to be updated/;

export function createTlmgr(binDir: string, logger: ILogger): Tlmgr {
  const executable = join(binDir, process.platform === "win32" ? "tlmgr.bat" : "tlmgr");
  const runOnce = async (args: string[], onProgress?: (fraction: number) => void): Promise<RunOutcome> => {
    const outcome = await runTexTool({ executable, args, cwd: binDir, logger, onProgress });
    if (outcome.code !== 0) { throw new TlmgrError(args, outcome.code, outcome.output); }
    return outcome;
  };
  const run = async (args: string[], onProgress?: (fraction: number) => void): Promise<RunOutcome> => {
    try {
      return await runOnce(args, onProgress);
    } catch (error) {
      if (!(error instanceof TlmgrError) || !STALE_SELF.test(error.output)) { throw error; }
      await logger.log("WARN", TEX_MODULE, "tlmgr is older than its repository; updating it and retrying", { args });
      await runOnce(["update", "--self"]);
      return runOnce(args, onProgress);
    }
  };
  return {
    async searchFile(fileName) {
      // A leading slash matches the whole file name instead of any path containing it.
      const { output } = await run(["search", "--global", "--file", `/${fileName}`]);
      const match = /^([^\s:]+):\s*$/m.exec(output);
      return match?.[1] ?? null;
    },
    async install(packages, onProgress) {
      await run(["install", ...packages], onProgress);
    },
    async listInstalled() {
      const { output } = await run(["info", "--list", "--only-installed", "--data", "name"]);
      return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    },
  };
}

/** Profile text for `install-tl --profile`; every tree lives under `texRoot` so nothing touches the user's own TeX. */
export function createTexLiveProfile(texRoot: string): string {
  const system = join(texRoot, "texlive");
  const user = join(texRoot, "user");
  return [
    "selected_scheme scheme-full",
    `TEXDIR ${system}`,
    `TEXMFLOCAL ${join(system, "texmf-local")}`,
    `TEXMFSYSCONFIG ${join(system, "texmf-config")}`,
    `TEXMFSYSVAR ${join(system, "texmf-var")}`,
    `TEXMFHOME ${join(user, "texmf")}`,
    `TEXMFVAR ${join(user, "texmf-var")}`,
    `TEXMFCONFIG ${join(user, "texmf-config")}`,
    // LabShelf puts the bin dir on PATH for its own builds; the user's PATH and desktop stay untouched.
    "instopt_adjustpath 0",
    "tlpdbopt_install_docfiles 0",
    "tlpdbopt_install_srcfiles 0",
    "tlpdbopt_desktop_integration 0",
    "tlpdbopt_file_assocs 0",
    "tlpdbopt_w32_multi_user 0",
    "",
  ].join("\n");
}

const TLNET = "https://mirror.ctan.org/systems/texlive/tlnet/";
const SHA512_LINE = /^([0-9a-f]{128})\s+\*?(\S+)$/im;

interface TexLiveInstaller {
  /** The archive file name, e.g. `install-tl-unx.tar.gz`. */
  name: string;
  kind: "tar.gz" | "zip";
  bytes: Buffer;
}

function texLiveInstallerName(platform: string): Pick<TexLiveInstaller, "name" | "kind"> {
  return platform === "win32" ? { name: "install-tl.zip", kind: "zip" } : { name: "install-tl-unx.tar.gz", kind: "tar.gz" };
}

async function fetchOk(fetchImpl: FetchLike, url: string): Promise<Response> {
  const response = await fetchImpl(url);
  if (!response.ok) { throw new Error(`Download failed with HTTP ${response.status} from ${url}`); }
  return response;
}

// TRAP: mirror.ctan.org redirects to a random mirror; the checksum must come from the mirror that served the bytes.
async function expectedSha512(fetchImpl: FetchLike, logger: ILogger, mirrorUrl: string, asset: string): Promise<string> {
  const checksumUrl = `${mirrorUrl}.sha512`;
  const checksum = Buffer.from(await (await fetchOk(fetchImpl, checksumUrl)).arrayBuffer());
  const signature = await (await fetchOk(fetchImpl, `${checksumUrl}.asc`)).text();
  if (!verifyDetachedSignature(checksum, signature, TEX_LIVE_SIGNING_KEY)) {
    await logger.log("WARN", TEX_MODULE, "TeX Live checksum signature does not match the pinned key", { asset, url: checksumUrl });
    throw new Error(`The OpenPGP signature of ${checksumUrl} does not match the pinned TeX Live key`);
  }
  const match = SHA512_LINE.exec(checksum.toString("utf8"));
  if (!match?.[1]) { throw new Error(`No SHA-512 found in ${checksumUrl}`); }
  if (match[2] !== asset) { throw new Error(`${checksumUrl} is the checksum of ${match[2]}, not ${asset}`); }
  return match[1].toLowerCase();
}

async function downloadTexLiveInstaller(fetchImpl: FetchLike, logger: ILogger, platform: string): Promise<TexLiveInstaller> {
  const { name, kind } = texLiveInstallerName(platform);
  const url = `${TLNET}${name}`;
  await logger.log("INFO", TEX_MODULE, "Downloading the TeX Live installer", { url });
  const response = await fetchOk(fetchImpl, url);
  const mirrorUrl = response.url || url;
  if (!mirrorUrl.startsWith("https://")) { throw new Error(`CTAN redirected the TeX Live installer to a non-HTTPS mirror: ${mirrorUrl}`); }
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = await expectedSha512(fetchImpl, logger, mirrorUrl, name);
  const actual = createHash("sha512").update(bytes).digest("hex");
  if (actual !== expected) {
    await logger.log("WARN", TEX_MODULE, "TeX Live installer checksum mismatch", { asset: name, url: mirrorUrl, expected, actual });
    throw new Error(`Checksum mismatch for ${mirrorUrl}: expected ${expected}, got ${actual}`);
  }
  await logger.log("INFO", TEX_MODULE, "TeX Live installer checksum ok", { url: mirrorUrl, bytes: bytes.length });
  return { name, kind, bytes };
}

function installTlCommand(dir: string, profile: string): { executable: string; args: string[] } {
  const args = ["--no-interaction", "--profile", profile];
  // PLATFORM: on Windows install-tl starts from its .bat and needs -non-admin to stay per-user.
  return process.platform === "win32"
    ? { executable: join(dir, "install-tl-windows.bat"), args: [...args, "-non-admin"] }
    : { executable: join(dir, "install-tl"), args };
}

export async function installTexLive(deps: TexInstallDeps, run: TexInstallRun): Promise<void> {
  run.onProgress(null);
  const root = resolveManagedTexDir(run.texRoot, "texlive");
  const installer = await downloadTexLiveInstaller(deps.fetchImpl, deps.logger, process.platform);
  await withStagingDir(run.texRoot, "texlive", async (staging) => {
    const tree = join(staging, "tree");
    await mkdir(tree);
    const archive = join(staging, installer.name);
    await writeFile(archive, installer.bytes);
    await extractArchive(archive, installer.kind, tree);
    const profile = join(staging, "texlive.profile");
    await writeFile(profile, createTexLiveProfile(run.texRoot));
    const command = installTlCommand(await findSingleTopDir(tree), profile);
    // INVARIANT: a texlive tree exists only after install-tl succeeded, because its presence means "installed".
    await rm(root, { recursive: true, force: true });
    const outcome = await runTexTool({ ...command, cwd: staging, logger: deps.logger, onProgress: run.onProgress });
    if (outcome.code !== 0) {
      await rm(root, { recursive: true, force: true });
      throw new Error(`install-tl exited with code ${outcome.code}: ${outcome.output.slice(-2000)}`);
    }
  });
  await deps.logger.log("INFO", TEX_MODULE, "TeX Live installed", { root });
  run.onProgress(1);
}

async function download(deps: TexInstallDeps, asset: TinyTexFile): Promise<Buffer> {
  await deps.logger.log("INFO", TEX_MODULE, "Downloading TinyTeX", { url: asset.url, sha256: asset.sha256 });
  try {
    const bytes = await downloadVerified(asset.url, asset.sha256, deps.fetchImpl);
    await deps.logger.log("INFO", TEX_MODULE, "TinyTeX checksum ok", { url: asset.url, bytes: bytes.length });
    return bytes;
  } catch (error) {
    await deps.logger.log("WARN", TEX_MODULE, "TinyTeX download failed its HTTP or checksum check", {
      asset: asset.name, url: asset.url, expected: asset.sha256, error: formatError(error),
    });
    throw error;
  }
}

async function unpack(deps: TexInstallDeps, archive: string, tree: string): Promise<void> {
  if (archive.endsWith(".exe")) {
    // PLATFORM: the Windows asset is a self-extracting archive that unpacks into its working directory.
    const outcome = await runTexTool({ executable: archive, args: ["-y"], cwd: tree, logger: deps.logger });
    if (outcome.code !== 0) {
      throw new Error(`TinyTeX self-extractor exited with code ${outcome.code}: ${outcome.output.slice(-2000)}`);
    }
    return;
  }
  // tar -xf detects the compression itself, so .tar.xz needs no xz flag.
  await deps.logger.log("INFO", TEX_MODULE, "Unpacking TinyTeX", { command: "tar", args: ["-xf", archive, "-C", tree] });
  await execFileAsync("tar", ["-xf", archive, "-C", tree]);
}

export async function installTinyTex(deps: TexInstallDeps, run: TexInstallRun): Promise<void> {
  run.onProgress(null);
  const asset = findTinyTexFile(deps.platform, process.arch);
  if (!asset) { throw new Error(`TinyTeX has no build for ${deps.platform}-${process.arch}`); }
  const bytes = await download(deps, asset);
  const target = resolveManagedTexDir(run.texRoot, "tinytex");
  await withStagingDir(run.texRoot, "tinytex", async (staging) => {
    const tree = join(staging, "tree");
    const archive = join(tree, asset.name);
    await mkdir(tree);
    await writeFile(archive, bytes);
    await unpack(deps, archive, tree);
    await rm(archive, { force: true });
    const top = await findSingleTopDir(tree);
    // INVARIANT: the old tree goes only after the new one is verified and unpacked.
    await rm(target, { recursive: true, force: true });
    await rename(top, target);
  });
  if (deps.platform === "darwin") { await removeQuarantine(target, deps.logger, deps.execFileImpl); }
  await deps.logger.log("INFO", TEX_MODULE, "TinyTeX installed", { root: target, asset: asset.name });
  run.onProgress(1);
}
