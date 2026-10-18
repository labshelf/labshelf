/** Provides the cached precompiled preamble format of a pdflatex preview, building it with mylatexformat when the preamble changed. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { readOptionalFile } from "../../../../../library/node/index.js";
import type { ILogger } from "../../../../../ports/index.js";
import type { LatexToolchain } from "../../../toolchain/index.js";
import { withToolchainOnPath } from "../../../toolchain/node/system/index.js";
import { BuildCancelled, runCancellable } from "../runCancellable.js";
import { preambleHash } from "./preambleHash.js";

export interface PreambleFormat {
  /** The format's name, passed as `-fmt`. */
  name: string;
  /** The folder that holds the format, searched through TEXFORMATS. */
  dir: string;
}

export interface FormatRequest {
  toolchain: LatexToolchain;
  /** The main file's absolute path; the format build runs in its folder. */
  mainPath: string;
  outDir: string;
  signal: AbortSignal;
  logger: ILogger;
}

/** The file through which a preview passes `\includeonly`; the format's hook reads it at `\begin{document}`. */
export const INCLUDE_ONLY_FILE = "labshelf-includeonly.tex";
const FORMAT_FOLDER = ".labshelf-fmt";
const MODULE = "writing/build";
const LOG_TAIL_LINES = 20;
// A failing preamble fails the same way on every keystroke, so it is tried once per process.
const failedHashes = new Set<string>();

// PLATFORM: a mylatexformat format swallows the input lines before `\begin{document}`, so `\includeonly` cannot come
// from the command line; the hook reads it from a file instead, found through the run's `-output-directory`.
function formatArgs(name: string, dir: string, mainFile: string): string[] {
  return [
    "-ini", "-interaction=nonstopmode", `-jobname=${name}`, `-output-directory=${dir}`, "&pdflatex",
    `\\AddToHook{begindocument/before}{\\InputIfFileExists{${INCLUDE_ONLY_FILE}}{}{}}\\input mylatexformat.ltx`, `"${mainFile}"`,
  ];
}

/** Deletes the formats, and their logs, of every other preamble in the folder. */
async function removeOtherFormats(dir: string, keep: string): Promise<void> {
  for (const entry of await fs.readdir(dir)) {
    if (path.basename(entry, path.extname(entry)) !== keep) { await fs.rm(path.join(dir, entry), { force: true }); }
  }
}

async function compileFormat(request: FormatRequest, name: string, dir: string): Promise<boolean> {
  const { toolchain, mainPath, logger } = request;
  const started = Date.now();
  await fs.mkdir(dir, { recursive: true });
  const outcome = await runCancellable("etex", formatArgs(name, dir, path.basename(mainPath)), path.dirname(mainPath), request.signal, {
    env: withToolchainOnPath(toolchain, process.env),
  }).catch(async (error: unknown) => {
    if (error instanceof BuildCancelled) { return undefined; }
    await logger.error(MODULE, error, { executable: "etex", main: mainPath });
    return undefined;
  });
  if (request.signal.aborted) { return false; }
  const built = outcome?.code === 0 && await fs.stat(path.join(dir, `${name}.fmt`)).then(() => true, () => false);
  if (!built) {
    const log = (await readOptionalFile(path.join(dir, `${name}.log`))) ?? outcome?.output ?? "";
    await logger.log("WARN", MODULE, "LaTeX preamble format build failed; the preview runs without it", {
      main: mainPath, code: outcome?.code ?? null, logTail: log.trim().split(/\r?\n/).slice(-LOG_TAIL_LINES).join("\n"),
    });
    return false;
  }
  await removeOtherFormats(dir, name);
  await logger.log("INFO", MODULE, "LaTeX preamble format built", { main: mainPath, format: name, ms: Date.now() - started });
  return true;
}

/** The format of main's current preamble, or none when the engine cannot use one or the build fails. */
export async function preambleFormat(request: FormatRequest): Promise<PreambleFormat | undefined> {
  if (request.toolchain.engine !== "pdflatex") {
    await request.logger.log("INFO", MODULE, "LaTeX preview runs without a preamble format: only pdflatex supports one", { engine: request.toolchain.engine });
    return undefined;
  }
  const name = await preambleHash(request.toolchain, request.mainPath);
  if (name === undefined) {
    await request.logger.log("INFO", MODULE, "LaTeX preview runs without a preamble format: main has no \\begin{document}", { main: request.mainPath });
    return undefined;
  }
  if (failedHashes.has(name)) { return undefined; }
  const dir = path.join(request.outDir, FORMAT_FOLDER);
  if (await fs.stat(path.join(dir, `${name}.fmt`)).then(() => true, () => false)) { return { name, dir }; }
  if (await compileFormat(request, name, dir)) { return { name, dir }; }
  if (!request.signal.aborted) { failedHashes.add(name); }
  return undefined;
}
