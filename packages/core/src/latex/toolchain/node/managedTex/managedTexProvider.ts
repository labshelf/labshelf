// Resolves TeX as managed, then system, then missing, and installs TeX and its packages into the shared managed install.
// CONTRACT: documents/contracts/managed-tools.md#resolution
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import type { TexToolchain } from "../../../../helper/index.js";
import type { LatexEngine } from "../../../../writing/project/index.js";

import type { TexInstallKind, TexProvider } from "../../index.js";
import { clearQuarantine, type ExecFile } from "./removeQuarantine.js";
import type { TexInstallRun } from "./texInstall.js";
import { TEX_MODULE } from "./runTexTool.js";
import { withToolLock } from "./toolsDirLock.js";
import { findManagedTex, type ManagedTex } from "./texLayout.js";
import { createTlmgr, isRollover, TlmgrFailed, type Tlmgr } from "./tlmgr.js";

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
  /** The shared TeX folder; `tex/` under sharedToolsRoot. */
  texRoot: string;
  logger: ILogger;
  /** macOS clears the quarantine attribute from an existing TinyTeX on first use; unset skips it. */
  platform?: NodeJS.Platform;
  /** Runs xattr; tests inject a fake. */
  execFileImpl?: ExecFile;
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
    if (!(error instanceof TlmgrFailed) || !isRollover(error.output)) { throw error; }
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
    await clearQuarantine(tex.root, ctx.logger, ctx.execFileImpl);
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
