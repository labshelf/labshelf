/** Previews an edit: the cached preamble format, the include-only file, the section typeset alone, and swapping its pages into the last shown PDF. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";

import { createLatexPreviewCommand, NO_SHELL_ESCAPE, TEX_FILE_ACCESS_ENV, type LatexBuildResult } from "../build.js";
import { readOptionalFile, writeFileAtomic } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import { deriveSectionProblems } from "../problems.js";
import {
  createSectionDocument, createSectionPreviewPlan, deriveSectionAux, deriveSectionPageRange, extractDefinitionsBeforeSection,
  type PageRange,
} from "../sectionPlan.js";
import {
  createSectionBuildStatePackage, deriveSectionBuildStateFileName, parseSectionBuildStates, SECTION_STATE_PACKAGE, type SectionState,
} from "../sectionState.js";
import { scanLatexSource } from "../source.js";
import { readLatexProjectSources, resolveIncludePath } from "../sourceProject.js";
import type { LatexToolchain } from "../toolchain.js";
import type { LatexBuildRequest } from "./build.js";
import { buildLatexProject, BuildCancelled, runCancellable, type ProblemPlaces } from "./run.js";
import { withToolchainOnPath } from "./systemTex.js";

const BEGIN_DOCUMENT = "\\begin{document}";
const USEPACKAGE = /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;

/** The project-relative paths, from main's folder, of the local files the preamble may load. */
function localCandidates(preamble: string): string[] {
  const inputs = scanLatexSource(preamble).includes.filter((fact) => fact.command === "input").map((fact) => resolveIncludePath(fact.path));
  const packages = [...preamble.matchAll(USEPACKAGE)].flatMap((match) => match[1]!.split(",")).map((name) => resolveIncludePath(`${name.trim()}.sty`));
  return [...inputs, ...packages].filter((file): file is string => file !== undefined);
}

/** The hash of main's preamble, or none when main has no `\begin{document}`. */
async function preambleHash(toolchain: LatexToolchain, mainPath: string): Promise<string | undefined> {
  const text = (await readOptionalFile(mainPath)) ?? "";
  const end = text.indexOf(BEGIN_DOCUMENT);
  if (end < 0) { return undefined; }
  const preamble = text.slice(0, end);
  const hash = createHash("sha256").update(`${toolchain.engine}\0${toolchain.executable}\0${preamble}`);
  // A package that is not a local file is part of TeX Live, which the toolchain path already identifies.
  for (const file of localCandidates(preamble)) {
    const content = await readOptionalFile(path.join(path.dirname(mainPath), file));
    if (content !== undefined) { hash.update(`\0${file}\0${content}`); }
  }
  return hash.digest("hex");
}

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
const INCLUDE_ONLY_FILE = "labshelf-includeonly.tex";
const FORMAT_FOLDER = ".labshelf-fmt";
const MODULE = "writing/build";
const LOG_TAIL_LINES = 20;
// A failing preamble fails the same way on every keystroke, so it is tried once per process.
const failedHashes = new Set<string>();

// PLATFORM: a mylatexformat format swallows the input lines before `\begin{document}`, so `\includeonly` cannot come
// from the command line; the hook reads it from a file instead, found through the run's `-output-directory`.
function formatArgs(name: string, dir: string, mainFile: string): string[] {
  return [
    "-ini", NO_SHELL_ESCAPE, "-interaction=nonstopmode", `-jobname=${name}`, `-output-directory=${dir}`, "&pdflatex",
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
    env: { ...withToolchainOnPath(toolchain, process.env), ...TEX_FILE_ACCESS_ENV },
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
export async function buildPreambleFormat(request: FormatRequest): Promise<PreambleFormat | undefined> {
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

/** Runs `run` with the include-only file written when `includeOnly` is given, and absent otherwise or afterwards. */
export async function withIncludeOnlyFile<T>(outDir: string, includeOnly: string | undefined, run: () => Promise<T>): Promise<T> {
  const file = path.join(outDir, INCLUDE_ONLY_FILE);
  // INVARIANT: every format run reads this file, so a stale one would hide every chapter but its own.
  if (includeOnly === undefined) { await fs.rm(file, { force: true }); }
  else { await fs.writeFile(file, `\\includeonly{${includeOnly}}\n`); }
  try {
    return await run();
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** The engine finds the package in its output folder, so the project's files stay untouched. */
export async function writeSectionBuildStatePackage(outDir: string): Promise<void> {
  await writeFileAtomic(path.join(outDir, `${SECTION_STATE_PACKAGE}.sty`), createSectionBuildStatePackage());
}

/** The states of the last full build of `jobName`, in source order; none when no full build wrote them. */
export async function readSectionBuildStates(outDir: string, jobName: string, logger: ILogger): Promise<SectionState[]> {
  const file = path.join(outDir, deriveSectionBuildStateFileName(jobName));
  const text = await readOptionalFile(file);
  if (text === undefined) {
    await logger.log("INFO", MODULE, "LaTeX build has no section state yet", { file });
    return [];
  }
  const { states, skipped } = parseSectionBuildStates(text);
  if (skipped > 0) { await logger.log("WARN", MODULE, "LaTeX section state has unreadable lines", { file, skipped, states: states.length }); }
  return states;
}

function indices(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);
}

// INVARIANT: no metadata update, so the same inputs give the same bytes and unchanged pages keep their hashes.
export async function updateSectionPages(full: Uint8Array, section: Uint8Array, range: PageRange): Promise<Uint8Array | undefined> {
  const base = await PDFDocument.load(full, { updateMetadata: false });
  const part = await PDFDocument.load(section, { updateMetadata: false });
  if (part.getPageCount() !== range.end - range.start + 1) return undefined;
  const out = await PDFDocument.create({ updateMetadata: false });
  const pages = [
    ...await out.copyPages(base, indices(0, range.start)),
    ...await out.copyPages(part, part.getPageIndices()),
    ...await out.copyPages(base, indices(range.end + 1, base.getPageCount())),
  ];
  for (const page of pages) { out.addPage(page); }
  return out.save();
}

// TRAP: the engine runs in main's folder, so include paths resolve from there, not from the project root.
function mainFolderPath(projectFolder: string, main: string, file: string): string {
  return path.relative(path.dirname(path.join(projectFolder, main)), path.join(projectFolder, file)).split(path.sep).join("/");
}

/** The PDF the build folder last produced for display: a full build's, or a section preview's swapped into it. */
export function deriveShownPdfName(base: string): string {
  return `${base}-full.pdf`;
}

interface SectionJob {
  edited: string;
  sources: Record<string, string>;
  states: SectionState[];
  sectionIndex: number;
  startLine: number;
  endLine: number;
}

/** Main and every file it inputs, keyed by their path from main's folder. */
async function readSources(request: LatexBuildRequest, mainDir: string): Promise<Record<string, string>> {
  const sources: Record<string, string> = {};
  await readLatexProjectSources(path.basename(request.main), {
    read: async (relativePath) => {
      const text = await readOptionalFile(path.join(mainDir, relativePath));
      if (text !== undefined) { sources[relativePath] = text; }
      return text;
    },
  });
  return sources;
}

async function fallBack(request: LatexBuildRequest, reason: string): Promise<undefined> {
  await request.logger.log("INFO", MODULE, `LaTeX section preview gives way to the one-pass preview of the document: ${reason}`, { main: request.main, reason });
  return undefined;
}

async function planJob(request: LatexBuildRequest, places: ProblemPlaces, base: string): Promise<SectionJob | string> {
  if (request.editedFile === undefined || request.editedLine === undefined) { return "no-edit"; }
  const edited = mainFolderPath(request.projectFolder, request.main, request.editedFile);
  const sources = await readSources(request, places.workDir);
  const states = await readSectionBuildStates(request.outDir, base, request.logger);
  const hasAux = await fs.stat(path.join(request.outDir, `${base}.aux`)).then(() => true, () => false);
  const plan = createSectionPreviewPlan({
    editedFile: edited, editedLine: request.editedLine - 1, sources, states, hasAux, engine: request.toolchain.engine, hasFormat: true,
  });
  if (plan.kind === "fallback") { return plan.reason; }
  if (sources[edited] === undefined) { return "edited-file-unread"; }
  return { edited, sources, states, sectionIndex: plan.sectionIndex, startLine: plan.startLine, endLine: plan.endLine };
}

/** Writes the filtered aux as the section job's aux and the section document; returns the document's header length. */
async function writeSectionDocument(request: LatexBuildRequest, base: string, job: SectionJob, formatName: string): Promise<number> {
  const aux = (await readOptionalFile(path.join(request.outDir, `${base}.aux`))) ?? "";
  // TRAP: `\newlabel` and `\bibcite` fail after `\begin{document}`, so the labels cannot be `\input` in the body.
  await writeFileAtomic(path.join(request.outDir, `${base}-section.aux`), deriveSectionAux(aux));
  const document = createSectionDocument({
    formatName, state: job.states[job.sectionIndex]!,
    definitions: extractDefinitionsBeforeSection({ sources: job.sources, main: path.basename(request.main), editedFile: job.edited, startLine: job.startLine }),
    sectionText: job.sources[job.edited]!.split("\n").slice(job.startLine, job.endLine).join("\n"),
  });
  await writeFileAtomic(path.join(request.outDir, `${base}-section.tex`), document.text);
  return document.headerLines;
}

/** The swapped PDF goes to the build folder, the shown copy and next to main. */
async function publishSwap(request: LatexBuildRequest, places: ProblemPlaces, base: string, job: SectionJob, sectionPdf: string): Promise<string | undefined> {
  const shown = await fs.readFile(path.join(request.outDir, deriveShownPdfName(base))).catch(() => undefined);
  if (!shown) return fallBack(request, "no-shown-pdf");
  const section = await fs.readFile(sectionPdf);
  const pageCount = (await PDFDocument.load(shown, { updateMetadata: false })).getPageCount();
  const swapped = await updateSectionPages(shown, section, deriveSectionPageRange(job.states, job.sectionIndex, pageCount));
  if (!swapped) return fallBack(request, "section-page-count-changed");
  const pdf = path.join(places.workDir, `${base}.pdf`);
  for (const file of [path.join(request.outDir, `${base}.pdf`), path.join(request.outDir, deriveShownPdfName(base)), pdf]) {
    await writeFileAtomic(file, swapped);
  }
  return pdf;
}

/** The section preview's result, or none after logging why the document preview runs instead. */
export async function runSectionPreview(request: LatexBuildRequest, places: ProblemPlaces, base: string): Promise<LatexBuildResult | undefined> {
  const job = await planJob(request, places, base);
  if (typeof job === "string") { return fallBack(request, job); }
  const found = await buildPreambleFormat({ ...request, mainPath: places.mainFile });
  if (!found) { return fallBack(request, "no-format"); }
  const headerLines = await writeSectionDocument(request, base, job, found.name);
  const documentName = `${base}-section.tex`;
  const command = createLatexPreviewCommand(request.toolchain.engine, documentName, request.outDir, {
    format: { name: found.name, searchPath: `${found.dir}${path.delimiter}` },
    ...(request.haltOnError !== undefined && { haltOnError: request.haltOnError }),
  });
  const result = await withIncludeOnlyFile(request.outDir, undefined, () => buildLatexProject(request, places, {
    job: `${base}-section`, command,
    mapProblems: (problems) => deriveSectionProblems(problems, { documentName, editedFile: job.edited, headerLines, startLine: job.startLine }),
  }));
  if (result.status === "cancelled") { return result; }
  if (result.status === "failed") {
    await request.logger.log("WARN", MODULE, "LaTeX section preview failed; the document preview runs instead", {
      main: request.main, section: job.sectionIndex, problems: result.problems.slice(0, 3).map((problem) => problem.message),
    });
    return undefined;
  }
  const pdf = await publishSwap(request, places, base, job, result.pdf);
  if (!pdf) return undefined;
  return { status: "succeeded", pdf, problems: result.problems };
}
