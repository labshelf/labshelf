// Resolves TeX as managed, then system, then missing, and installs TeX and its packages into the managed install.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ILogger } from "@labshelf/core";
import type { HelperEngine, TexInstallKind, TexStatus } from "@labshelf/core/helper";

import type { TexProvider } from "../build/index.js";
import type { TexInstallRun } from "./install/index.js";
import { TEX_MODULE } from "./runTexTool.js";
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
  dataDir: string;
  logger: ILogger;
  /** Used when no managed install exists; never changed. */
  system: TexProvider;
  installers: Record<TexInstallKind, TexInstaller>;
}

export interface ManagedTexProvider extends TexProvider {
  status(): Promise<TexStatus>;
  install(kind: TexInstallKind, onProgress: TexProgress): Promise<TexStatus>;
  installAllPackages(onProgress: TexProgress): Promise<TexStatus>;
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

async function texStatus(ctx: ManagedTexProviderOptions): Promise<TexStatus> {
  const tex = await findManagedTex(ctx.dataDir);
  if (tex) { return { source: tex.kind, ...(tex.year === null ? {} : { year: tex.year }), complete: await isComplete(ctx, tex) }; }
  return (await ctx.system.resolve("pdflatex")) === "missing" ? { source: "none", complete: false } : { source: "system", complete: true };
}

// TRAP: once CTAN moves to the next release, tlmgr refuses every repository action until the install is replaced.
async function reinstallTinyTex(ctx: ManagedTexProviderOptions, tex: ManagedTex, onProgress: TexProgress): Promise<ManagedTex> {
  const { dataDir, logger } = ctx;
  const packages = await createTlmgr(tex.binDir, logger).listInstalled();
  const listFile = join(dataDir, "tex", "tinytex-packages.txt");
  await mkdir(join(dataDir, "tex"), { recursive: true });
  await writeFile(listFile, packages.map((name) => `${name}\n`).join(""));
  await info(ctx, "TinyTeX is behind the repository; reinstalling it with its packages", { year: tex.year, packages: packages.length, listFile });
  await ctx.installers.tinytex({ dataDir, onProgress });
  const fresh = await findManagedTex(dataDir);
  if (fresh?.kind !== "tinytex") { throw new Error(`TinyTeX reinstall left no TinyTeX under ${join(dataDir, "tex")}`); }
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

async function installMissingFile(ctx: ManagedTexProviderOptions, fileName: string): Promise<boolean> {
  const tex = await findManagedTex(ctx.dataDir);
  if (!tex) {
    await info(ctx, "No managed TeX; a missing package is left to the system TeX", { fileName });
    return false;
  }
  try {
    return await withRollover(ctx, tex, () => undefined, async (tlmgr) => {
      const name = await tlmgr.searchFile(fileName);
      if (name === null) {
        await info(ctx, "No package provides the missing file", { fileName });
        return false;
      }
      await tlmgr.install([name]);
      await info(ctx, "Installed the package for a missing file", { fileName, package: name });
      return true;
    });
  } catch (error) {
    await ctx.logger.error(TEX_MODULE, error, { step: "install missing package", fileName, kind: tex.kind });
    return false;
  }
}

export function createManagedTexProvider(ctx: ManagedTexProviderOptions): ManagedTexProvider {
  const { dataDir } = ctx;
  return {
    async resolve(engine: HelperEngine) {
      const tex = await findManagedTex(dataDir);
      return tex ? { engine, executable: latexmkIn(tex.binDir) } : ctx.system.resolve(engine);
    },
    installMissing: (fileName) => installMissingFile(ctx, fileName),
    status: () => texStatus(ctx),
    async install(kind, onProgress) {
      await info(ctx, "Installing managed TeX", { kind, dataDir });
      await ctx.installers[kind]({ dataDir, onProgress });
      await info(ctx, "Installed managed TeX", { kind });
      return texStatus(ctx);
    },
    async installAllPackages(onProgress) {
      const tex = await findManagedTex(dataDir);
      if (!tex) { throw new TexInstallError("no-managed-tex", "Every package can be installed only into a TeX that LabShelf Helper installed."); }
      await info(ctx, "Installing every package", { kind: tex.kind, year: tex.year });
      await withRollover(ctx, tex, onProgress, (tlmgr) => tlmgr.install(["scheme-full"], onProgress));
      await info(ctx, "Installed every package", { kind: tex.kind });
      return { ...(await texStatus(ctx)), complete: true };
    },
  };
}
