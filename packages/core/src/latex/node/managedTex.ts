// Keeps the shared managed-tools folder and its lock, finds the managed TeX in it, and resolves and installs TeX through the shared provider.
import * as path from "node:path";
import { link, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promises as fs } from "node:fs";
import { sleep } from "../../async/index.js";
import { errorCode } from "../../errors/index.js";
import type { ILogger, FetchLike } from "../../ports/index.js";
import type { TexToolchain } from "../../helper/index.js";
import type { LatexEngine } from "../../writing/project/index.js";
import type { TexInstallKind, TexProvider } from "../toolchain.js";
import { removeQuarantine, type RunFile, type TexInstallRun, TEX_MODULE, createTlmgr, isRollover, TlmgrError, type Tlmgr, installTexLive, installTinyTex, resolveManagedTexDir } from "./texInstallers.js";
import { createSystemTexProvider } from "./systemTex.js";

// CONTRACT: documents/contracts/managed-tools.md#layout
export function resolveSharedToolsDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  if (platform === "darwin") { return path.join(homeDir, "Library", "Application Support", "LabShelf"); }
  if (platform === "win32") { return path.join(env["LOCALAPPDATA"] || path.join(homeDir, "AppData", "Local"), "LabShelf"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(homeDir, ".local", "share"), "labshelf");
}

// CONTRACT: documents/contracts/managed-tools.md#lock
const LOCK_MODULE = "ToolLock";

export interface ToolsDirLockOptions {
  pollMs?: number;
  timeoutMs?: number;
  isAlive?: (pid: number) => boolean;
}

interface Holder { pid: number; operation: string; startedAt: string }

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return errorCode(error) === "EPERM";
  }
}

async function tryCreate(file: string, content: string): Promise<boolean> {
  try {
    await writeFile(file, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (errorCode(error) === "EEXIST") { return false; }
    throw error;
  }
}

/** The lock's text, or null when it vanished between the failed create and this read. */
async function readLock(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") { return null; }
    throw error;
  }
}

function parseHolder(text: string): Holder | null {
  try {
    const value = JSON.parse(text) as Partial<Holder>;
    return typeof value.pid === "number" && typeof value.operation === "string" ? value as Holder : null;
  } catch {
    return null;
  }
}

async function isStale(file: string, text: string, timeoutMs: number, isAlive: (pid: number) => boolean): Promise<boolean> {
  const holder = parseHolder(text);
  if (holder) { return !isAlive(holder.pid); }
  // TRAP: a holder may be between creating the file and writing it, so only an old garbled lock is stale.
  try {
    return Date.now() - (await stat(file)).mtimeMs > timeoutMs;
  } catch {
    return false;
  }
}

/** Removes the lock only if it still holds `text`; a lock another process took in between is put back. */
async function removeStale(file: string, text: string, logger: ILogger): Promise<void> {
  const aside = `${file}.stale-${process.pid}-${Date.now()}`;
  try {
    await rename(file, aside);
  } catch (error) {
    if (errorCode(error) === "ENOENT") { return; }
    throw error;
  }
  if ((await readLock(aside)) !== text) {
    await link(aside, file).catch((error: unknown) => logger.error(LOCK_MODULE, error, { step: "restore a tool lock taken over by mistake", file }));
  }
  await rm(aside, { force: true });
}

async function releaseOwn(file: string, own: string, logger: ILogger): Promise<void> {
  try {
    if ((await readLock(file)) === own) { await rm(file, { force: true }); }
  } catch (error) {
    await logger.error(LOCK_MODULE, error, { step: "release tool lock", file });
  }
}

/** Runs `run` while holding `<folder>/.lock`; waits for another holder and takes over a stale lock. */
export async function withToolLock<T>(folder: string, operation: string, logger: ILogger, run: () => Promise<T>, options: ToolsDirLockOptions = {}): Promise<T> {
  const { pollMs = 500, timeoutMs = 15 * 60_000, isAlive = processAlive } = options;
  const file = join(folder, ".lock");
  const own = JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() } satisfies Holder);
  await mkdir(folder, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let waiting = false;
  while (!(await tryCreate(file, own))) {
    const text = await readLock(file);
    if (text === null) { continue; }
    if (await isStale(file, text, timeoutMs, isAlive)) {
      await logger.log("WARN", LOCK_MODULE, "Taking over a stale tool lock", { file, holder: text, operation });
      await removeStale(file, text, logger);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)} s waiting to ${operation}: ${folder} is locked by ${text}`);
    }
    if (!waiting) {
      waiting = true;
      await logger.log("INFO", LOCK_MODULE, "Waiting for another LabShelf process to finish with a managed tool folder", { file, holder: text, operation });
    }
    await sleep(pollMs);
  }
  try {
    return await run();
  } finally {
    await releaseOwn(file, own, logger);
  }
}

export type ManagedTexKind = "texlive" | "tinytex";

export interface ManagedTex {
  kind: ManagedTexKind;
  root: string;
  /** `<root>/bin/<arch>`, holding tlmgr and latexmk. */
  binDir: string;
  /** The TeX Live release, or null when `release-texlive.txt` is missing or unreadable. */
  year: number | null;
}

// INVARIANT: a full TeX Live is preferred over TinyTeX when both are present.
const KINDS: ManagedTexKind[] = ["texlive", "tinytex"];

async function firstBinDir(root: string): Promise<string | null> {
  try {
    const arches = (await fs.readdir(join(root, "bin"), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    const arch = arches.map((entry) => entry.name).sort()[0];
    return arch === undefined ? null : join(root, "bin", arch);
  } catch {
    return null;
  }
}

export async function readTexLiveYear(root: string): Promise<number | null> {
  try {
    const match = /version (\d{4})/.exec(await fs.readFile(join(root, "release-texlive.txt"), "utf8"));
    return match?.[1] ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** The managed TeX under `texRoot`, or null when none has a bin dir. */
export async function findManagedTex(texRoot: string): Promise<ManagedTex | null> {
  for (const kind of KINDS) {
    const root = resolveManagedTexDir(texRoot, kind);
    const binDir = await firstBinDir(root);
    if (binDir !== null) { return { kind, root, binDir, year: await readTexLiveYear(root) }; }
  }
  return null;
}

// CONTRACT: documents/contracts/managed-tools.md#tex-resolution
export type TexInstaller = (run: TexInstallRun) => Promise<void>;
export type TexProgress = (fraction: number | null) => void;

// CONTRACT: documents/contracts/helper.md#messages
export class TexInstallError extends Error {
  constructor(readonly code: "texlive-rollover" | "no-managed-tex", message: string) {
    super(message);
    this.name = "TexInstallError";
  }
}

export interface ManagedTexProviderOptions {
  /** The shared TeX folder; `tex/` under resolveSharedToolsDir. */
  texRoot: string;
  logger: ILogger;
  /** macOS clears the quarantine attribute from an existing TinyTeX on first use; unset skips it. */
  platform?: NodeJS.Platform;
  /** Runs xattr; tests inject a fake. */
  execFileImpl?: RunFile;
  /** Used when no managed install exists; never changed. */
  system: TexProvider;
  installers: Record<TexInstallKind, TexInstaller>;
}

export interface ManagedTexProvider extends TexProvider {
  status(): Promise<TexToolchain>;
  install(kind: TexInstallKind, onProgress: TexProgress): Promise<TexToolchain>;
  installAllPackages(onProgress: TexProgress): Promise<TexToolchain>;
}

const latexmkIn = (binDir: string): string => join(binDir, process.platform === "win32" ? "latexmk.exe" : "latexmk");

const info = (ctx: ManagedTexProviderOptions, message: string, context: Record<string, unknown> = {}) =>
  ctx.logger.log("INFO", TEX_MODULE, message, context);

async function isComplete(ctx: ManagedTexProviderOptions, tex: ManagedTex): Promise<boolean> {
  if (tex.kind === "texlive") { return true; }
  try {
    return (await createTlmgr(tex.binDir, ctx.logger).listInstalled()).includes("scheme-full");
  } catch (error) {
    await ctx.logger.error(TEX_MODULE, error, { step: "list installed packages", root: tex.root });
    return false;
  }
}

async function texStatus(ctx: ManagedTexProviderOptions): Promise<TexToolchain> {
  const tex = await findManagedTex(ctx.texRoot);
  if (tex) { return { source: tex.kind, ...(tex.year === null ? {} : { year: tex.year }), complete: await isComplete(ctx, tex) }; }
  return (await ctx.system.resolve("pdflatex")) === "missing" ? { source: "none", complete: false } : { source: "system", complete: true };
}

// TRAP: once CTAN moves to the next release, tlmgr refuses every repository action until the install is replaced.
async function reinstallTinyTex(ctx: ManagedTexProviderOptions, tex: ManagedTex, onProgress: TexProgress): Promise<ManagedTex> {
  const { texRoot, logger } = ctx;
  const packages = await createTlmgr(tex.binDir, logger).listInstalled();
  const listFile = join(texRoot, "tinytex-packages.txt");
  await mkdir(texRoot, { recursive: true });
  await writeFile(listFile, packages.map((name) => `${name}\n`).join(""));
  await info(ctx, "TinyTeX is behind the repository; reinstalling it with its packages", { year: tex.year, packages: packages.length, listFile });
  await ctx.installers.tinytex({ texRoot, onProgress });
  const fresh = await findManagedTex(texRoot);
  if (fresh?.kind !== "tinytex") { throw new Error(`TinyTeX reinstall left no TinyTeX under ${texRoot}`); }
  await createTlmgr(fresh.binDir, logger).install(packages);
  await info(ctx, "TinyTeX reinstalled after the rollover", { year: fresh.year, packages: packages.length });
  return fresh;
}

/** Runs a tlmgr action; on a rollover, reinstalls TinyTeX and retries once, or stops a TeX Live unchanged. */
async function withRollover<T>(ctx: ManagedTexProviderOptions, tex: ManagedTex, onProgress: TexProgress, run: (tlmgr: Tlmgr) => Promise<T>): Promise<T> {
  try {
    return await run(createTlmgr(tex.binDir, ctx.logger));
  } catch (error) {
    if (!(error instanceof TlmgrError) || !isRollover(error.output)) { throw error; }
    if (tex.kind === "texlive") {
      await info(ctx, "TeX Live is behind the repository; left unchanged until the user confirms", { year: tex.year, root: tex.root });
      throw new TexInstallError("texlive-rollover", `TeX Live ${tex.year ?? "(unknown year)"} is older than the package repository; reinstall it to install packages.`);
    }
    const fresh = await reinstallTinyTex(ctx, tex, onProgress);
    return run(createTlmgr(fresh.binDir, ctx.logger));
  }
}

// INVARIANT: every caller of withRollover holds the TeX lock, so the rollover reinstall runs under it too.
const locked = <T>(ctx: ManagedTexProviderOptions, operation: string, run: () => Promise<T>): Promise<T> =>
  withToolLock(ctx.texRoot, operation, ctx.logger, run);

async function installMissingFile(ctx: ManagedTexProviderOptions, fileName: string): Promise<boolean> {
  if (!(await findManagedTex(ctx.texRoot))) {
    await info(ctx, "No managed TeX; a missing package is left to the system TeX", { fileName });
    return false;
  }
  try {
    // Another process may have installed the package while this one waited; tlmgr install of an installed package is a no-op.
    return await locked(ctx, `install the package for ${fileName}`, async () => {
      const tex = await findManagedTex(ctx.texRoot);
      if (!tex) { return false; }
      return withRollover(ctx, tex, () => undefined, async (tlmgr) => {
        const name = await tlmgr.searchFile(fileName);
        if (name === null) {
          await info(ctx, "No package provides the missing file", { fileName });
          return false;
        }
        await tlmgr.install([name]);
        await info(ctx, "Installed the package for a missing file", { fileName, package: name });
        return true;
      });
    });
  } catch (error) {
    await ctx.logger.error(TEX_MODULE, error, { step: "install missing package", fileName, texRoot: ctx.texRoot });
    return false;
  }
}

async function installKind(ctx: ManagedTexProviderOptions, kind: TexInstallKind, onProgress: TexProgress): Promise<void> {
  const before = await findManagedTex(ctx.texRoot);
  await locked(ctx, `install ${kind}`, async () => {
    const now = await findManagedTex(ctx.texRoot);
    // Another process installed this kind while this one waited; a kind present before the request is reinstalled on purpose.
    if (now?.kind === kind && (before?.kind !== kind || before.year !== now.year)) {
      await info(ctx, "Managed TeX was installed by another LabShelf process while waiting", { kind, year: now.year });
      return;
    }
    await info(ctx, "Installing managed TeX", { kind, texRoot: ctx.texRoot });
    await ctx.installers[kind]({ texRoot: ctx.texRoot, onProgress });
    await info(ctx, "Installed managed TeX", { kind });
  });
}

async function installEveryPackage(ctx: ManagedTexProviderOptions, onProgress: TexProgress): Promise<void> {
  await locked(ctx, "install every package", async () => {
    const tex = await findManagedTex(ctx.texRoot);
    if (!tex) { throw new TexInstallError("no-managed-tex", "Every package can be installed only into a TeX that LabShelf installed."); }
    await info(ctx, "Installing every package", { kind: tex.kind, year: tex.year });
    await withRollover(ctx, tex, onProgress, (tlmgr) => tlmgr.install(["scheme-full"], onProgress));
    await info(ctx, "Installed every package", { kind: tex.kind });
  });
}

export function createManagedTexProvider(ctx: ManagedTexProviderOptions): ManagedTexProvider {
  let healed = false;
  // Heals installs made before the attribute was removed. INVARIANT: xattr removal is idempotent, so it needs no tool lock.
  const heal = async (tex: ManagedTex) => {
    if (ctx.platform !== "darwin" || tex.kind !== "tinytex" || healed) { return; }
    healed = true;
    await removeQuarantine(tex.root, ctx.logger, ctx.execFileImpl);
  };
  return {
    async resolve(engine: LatexEngine) {
      const tex = await findManagedTex(ctx.texRoot);
      if (tex) { await heal(tex); }
      return tex ? { engine, executable: latexmkIn(tex.binDir), binDir: tex.binDir } : ctx.system.resolve(engine);
    },
    installMissing: (fileName) => installMissingFile(ctx, fileName),
    status: () => texStatus(ctx),
    async install(kind, onProgress) {
      await installKind(ctx, kind, onProgress);
      return texStatus(ctx);
    },
    async installAllPackages(onProgress) {
      await installEveryPackage(ctx, onProgress);
      return { ...(await texStatus(ctx)), complete: true };
    },
  };
}

export interface SharedTexProviderOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDir: string;
  logger: ILogger;
  fetchImpl: FetchLike;
}

export function createSharedTexProvider({ env, platform, homeDir, logger, fetchImpl }: SharedTexProviderOptions): ManagedTexProvider {
  const deps = { fetchImpl, logger, platform };
  return createManagedTexProvider({
    texRoot: join(resolveSharedToolsDir(env, platform, homeDir), "tex"),
    logger,
    platform,
    system: createSystemTexProvider(),
    installers: { tinytex: (run) => installTinyTex(deps, run), texlive: (run) => installTexLive(deps, run) },
  });
}
