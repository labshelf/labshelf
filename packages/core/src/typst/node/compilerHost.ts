// Runs Typst for an app: opens its one compiler on first use (the WASM the app supplies, Typst's default fonts kept in a version folder and downloaded with checksums checked, the package folders), and compiles a project to PDF with the Typst Universe packages it imports.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { formatError } from "../../errors/index.js";
import { isFile } from "../../files/node/index.js";
import { writeFileAtomic } from "../../library/node/index.js";
import type { LocatedProblem } from "../../latex/index.js";
import { downloadVerified } from "../../latex/node/index.js";
import type { ILogger, FetchLike } from "../../ports/index.js";
import { deriveTypstProblems, openTypstSession, TYPST_FONT_BASE_URL, TYPST_FONTS, TYPST_VERSION, type TypstFontFile, type TypstBuildResult, type TypstCompileResult, type TypstSession } from "../typst.js";
import { deriveFilePathFromCompilerPath, deriveTypstCompilerPath, nodeTypstFiles, formatPackageLabel, TypstPackageStore, type TypstPackageDirs } from "./compilerFiles.js";

const MODULE = "writing/typst";

export interface TypstFontOptions {
  logger: ILogger;
  signal?: AbortSignal;
  /** Replaces the global fetch; tests serve the fonts from memory. */
  fetch?: FetchLike;
}

function versionDir(fontsDir: string): string {
  return path.join(fontsDir, TYPST_VERSION);
}

/** The default fonts not stored yet; a font is only ever written after its checksum matched. */
export async function listMissingTypstFonts(fontsDir: string): Promise<TypstFontFile[]> {
  const present = await Promise.all(TYPST_FONTS.map((font) => isFile(path.join(versionDir(fontsDir), font.file))));
  return TYPST_FONTS.filter((_, index) => !present[index]);
}

/** Every default font's bytes, downloading the missing ones first; throws when a download fails or a checksum differs. */
export async function loadTypstFonts(fontsDir: string, options: TypstFontOptions): Promise<Uint8Array[]> {
  const dir = versionDir(fontsDir);
  const missing = await listMissingTypstFonts(fontsDir);
  if (missing.length > 0) {
    await options.logger.log("INFO", MODULE, "Downloading Typst fonts", { count: missing.length, dir });
    await fs.mkdir(dir, { recursive: true });
    for (const font of missing) {
      const bytes = await downloadVerified(`${TYPST_FONT_BASE_URL}${font.file}`, font.sha256, options.fetch ?? fetch, options.signal);
      await writeFileAtomic(path.join(dir, font.file), bytes);
    }
  }
  return Promise.all(TYPST_FONTS.map(async (font) => new Uint8Array(await fs.readFile(path.join(dir, font.file)))));
}

export interface TypstCompiler {
  session: TypstSession;
  packages: TypstPackageStore;
}

export interface TypstCompilerHostOptions {
  wasm(): Promise<Uint8Array>;
  /** The folder the default fonts are kept in, one subfolder per Typst version. */
  fontsDir: string;
  packageDirs: TypstPackageDirs;
  /** Wraps the font download, which only the first open of a fresh install runs, so the app can show it. */
  withFontDownload?<T>(run: () => Promise<T>): Promise<T>;
}

export class TypstCompilerHost {
  private opening: Promise<TypstCompiler> | undefined;

  constructor(private readonly options: TypstCompilerHostOptions) {}

  /** The compiler; a failed open, such as a font download while offline, is tried again on the next call. */
  get(logger: ILogger): Promise<TypstCompiler> {
    if (!this.opening) {
      const opening = this.open(logger);
      this.opening = opening;
      opening.catch(() => { if (this.opening === opening) { this.opening = undefined; } });
    }
    return this.opening;
  }

  private async fonts(logger: ILogger): Promise<Uint8Array[]> {
    const { fontsDir, withFontDownload } = this.options;
    const load = (): Promise<Uint8Array[]> => loadTypstFonts(fontsDir, { logger });
    if ((await listMissingTypstFonts(fontsDir)).length === 0 || !withFontDownload) { return load(); }
    return withFontDownload(load);
  }

  private async open(logger: ILogger): Promise<TypstCompiler> {
    const started = Date.now();
    const wasm = await this.options.wasm();
    const packages = new TypstPackageStore(this.options.packageDirs);
    const session = await openTypstSession({ wasm, fonts: await this.fonts(logger), files: nodeTypstFiles, packages });
    await logger.log("INFO", MODULE, "Opened the Typst compiler", { ms: Date.now() - started });
    return { session, packages };
  }
}

export interface TypstBuildRequest {
  session: TypstSession;
  packages: TypstPackageStore;
  projectFolder: string;
  /** The main file, relative to the project folder. */
  main: string;
  /** Unsaved editor text by absolute file path. */
  sources: ReadonlyMap<string, string>;
  /** Where the PDF goes; the result names the first. */
  outputs: readonly [string, ...string[]];
  logger: ILogger;
  /** Replaces the global fetch for package downloads. */
  fetch?: FetchLike;
  signal?: AbortSignal;
}

function compileOnce(request: TypstBuildRequest, mainFile: string): Promise<TypstCompileResult> {
  const sources = new Map([...request.sources].map(([file, text]) => [deriveTypstCompilerPath(file), text]));
  return request.session.compile({ root: deriveTypstCompilerPath(request.projectFolder), main: deriveTypstCompilerPath(mainFile), sources });
}

/** Downloads the packages the last compile missed; returns a problem per package that could not be fetched. */
async function fetchMissing(request: TypstBuildRequest, mainFile: string): Promise<LocatedProblem[] | undefined> {
  const missing = request.packages.takeMissing();
  if (missing.length === 0) { return undefined; }
  const failures: LocatedProblem[] = [];
  for (const spec of missing) {
    try {
      await request.packages.download(spec, request.fetch ?? fetch, request.signal);
      await request.logger.log("INFO", MODULE, "Downloaded Typst package", { package: formatPackageLabel(spec) });
    } catch (error) {
      await request.logger.error(MODULE, error, { package: formatPackageLabel(spec) });
      failures.push({ severity: "error", message: `Could not download ${formatPackageLabel(spec)}: ${formatError(error)}`, file: mainFile });
    }
  }
  return failures;
}

export async function runTypstBuild(request: TypstBuildRequest): Promise<TypstBuildResult> {
  const mainFile = path.join(request.projectFolder, request.main);
  let result = await compileOnce(request, mainFile);
  const downloadFailures = await fetchMissing(request, mainFile);
  if (downloadFailures && downloadFailures.length === 0) { result = await compileOnce(request, mainFile); }
  const problems = [...downloadFailures ?? [], ...deriveTypstProblems(result.diagnostics, mainFile, deriveFilePathFromCompilerPath)];
  if (!result.pdf) {
    if (!problems.some((problem) => problem.severity === "error")) {
      problems.unshift({ severity: "error", message: "Typst produced no PDF and reported no error.", file: mainFile });
    }
    return { status: "failed", problems };
  }
  const pdf = result.pdf;
  await Promise.all(request.outputs.map((output) => writeFileAtomic(output, pdf)));
  const citations = result.citations ?? { failure: "The compile reported no citations." };
  if ("failure" in citations) {
    await request.logger.log("WARN", MODULE, "Citation positions unavailable; the preview shows no citation cards", { main: mainFile, reason: citations.failure });
  }
  return { status: "succeeded", pdf: request.outputs[0], problems, cites: "cites" in citations ? citations.cites : [] };
}
