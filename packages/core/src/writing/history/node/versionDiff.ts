/** Compares versions of a project on the real disk: a PDF of the LaTeX sources marking what changed (latexdiff), and the changed regions between two PDF files. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PdfjsLoader } from "../../../import/index.js";
import { withPdfDocument } from "../../../import/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { createLatexBuildCommand, type LatexToolchain } from "../../../latex/index.js";
import { findExecutable, runCancellable } from "../../../latex/node/index.js";
import { derivePageInk, type PageInk } from "../pageBlocks.js";
import { comparePdfPages, type PdfChanges } from "../versionDiff.js";

// --- Marked-up PDF ---

interface LatexdiffRequest {
  beforeMain: string;
  afterMain: string;
  /** Where latexdiff's stdout and stderr are kept. */
  outDir: string;
  signal: AbortSignal;
}

// Quotes one argument for the shell runCancellable starts: sh on Unix, cmd on Windows.
function quote(value: string): string {
  return process.platform === "win32" ? `"${value}"` : `'${value.replace(/'/g, "'\\''")}'`;
}

/** The last non-empty lines of a program's output, for an error message. */
function outputTail(output: string, lines = 12): string {
  return output.split(/\r?\n/).filter((line) => line.trim() !== "").slice(-lines).join("\n");
}

/**
 * @returns the path of the written diff.tex
 * @throws when latexdiff is not installed or exits with an error; the message ends with its error output
 */
async function runLatexdiff(request: LatexdiffRequest): Promise<string> {
  const latexdiff = await findExecutable("latexdiff");
  if (!latexdiff) { throw new Error("latexdiff is not installed. It comes with TeX Live."); }
  const diffTex = path.join(request.outDir, "diff.tex");
  const errorLog = path.join(request.outDir, "latexdiff.log");
  // TRAP: runCancellable keeps stdout and stderr interleaved and only the last 64 KiB, so piping stdout through it would
  // truncate or mix latexdiff's warnings into the document; the shell redirects keep each stream whole in its own file.
  const command = `${quote(latexdiff)} --flatten ${quote(request.beforeMain)} ${quote(request.afterMain)} > ${quote(diffTex)} 2> ${quote(errorLog)}`;
  await fs.mkdir(request.outDir, { recursive: true });
  const outcome = await runCancellable(command, [], path.dirname(request.afterMain), request.signal, { shell: true });
  if (outcome.code !== 0) {
    const stderr = await fs.readFile(errorLog, "utf8").catch(() => outcome.output);
    throw new Error(`latexdiff failed with exit code ${outcome.code ?? "none"}:\n${outputTail(stderr)}`);
  }
  return diffTex;
}

const DIFF_MODULE = "writing/versions";

export interface DiffRequest {
  /** The sources of the older side. */
  beforeDir: string;
  /** The sources of the newer side; the diff compiles with its folder as the working directory. */
  afterDir: string;
  /** The main file, relative to both folders. */
  main: string;
  /** Receives diff.tex, the build files and diff.pdf. */
  outDir: string;
  toolchain: LatexToolchain;
  signal: AbortSignal;
}

async function compileDiff(request: DiffRequest, diffTex: string): Promise<string> {
  // The working directory is the newer sources' folder so the relative \includegraphics and \input paths that
  // latexdiff leaves in place resolve as in the project's own build.
  const cwd = path.dirname(path.join(request.afterDir, request.main));
  const command = createLatexBuildCommand(request.toolchain, diffTex, request.outDir);
  const outcome = await runCancellable(command.executable, command.args, cwd, request.signal, { env: { ...process.env, ...command.env } });
  const pdf = path.join(request.outDir, "diff.pdf");
  if (outcome.code === 0 && await fs.stat(pdf).then(() => true, () => false)) { return pdf; }
  throw new Error(`The marked-up PDF did not compile (exit code ${outcome.code ?? "none"}):\n${outputTail(outcome.output)}`);
}

/**
 * @returns the path of diff.pdf in `outDir`
 * @throws when latexdiff or the LaTeX build fails or is cancelled; the message carries the tail of the failing tool's output
 */
export async function buildMarkedUpDiff(request: DiffRequest, logger: ILogger): Promise<string> {
  const started = Date.now();
  const context = { beforeDir: request.beforeDir, afterDir: request.afterDir, main: request.main, outDir: request.outDir };
  await logger.log("INFO", DIFF_MODULE, "Building a marked-up PDF with latexdiff", context);
  try {
    const diffTex = await runLatexdiff({
      beforeMain: path.join(request.beforeDir, request.main),
      afterMain: path.join(request.afterDir, request.main),
      outDir: request.outDir,
      signal: request.signal,
    });
    const pdf = await compileDiff(request, diffTex);
    await logger.log("INFO", DIFF_MODULE, "Built a marked-up PDF", { ...context, pdf, ms: Date.now() - started });
    return pdf;
  } catch (error) {
    await logger.log("WARN", DIFF_MODULE, "Could not build a marked-up PDF", { ...context, error: String(error) });
    throw error;
  }
}

// --- PDF comparison ---

/**
 * @param pixelsPerPoint render scale; 1.5 (108 dpi) separates text lines while keeping a page near a million pixels
 * @throws when no native canvas is installed, since nothing could be drawn
 */
async function renderPageInks(pdfjs: PdfjsLoader, pdfPath: string, pixelsPerPoint: number): Promise<PageInk[]> {
  const bytes = await fs.readFile(pdfPath);
  return withPdfDocument(pdfjs, bytes, async (document, canvasModule) => {
    const pages: PageInk[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: pixelsPerPoint });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const canvas = canvasModule.createCanvas(width, height);
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, width, height);
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      pages.push(derivePageInk(context.getImageData(0, 0, width, height).data, width, height));
      page.cleanup();
    }
    return pages;
  });
}

const COMPARE_MODULE = "writing/compare";
const PIXELS_PER_POINT = 1.5;

export async function comparePdfs(pdfjs: PdfjsLoader, beforePdf: string, afterPdf: string, logger: ILogger): Promise<PdfChanges> {
  const started = Date.now();
  const before = await renderPageInks(pdfjs, beforePdf, PIXELS_PER_POINT);
  const after = await renderPageInks(pdfjs, afterPdf, PIXELS_PER_POINT);
  const changes = comparePdfPages(before, after, PIXELS_PER_POINT);
  void logger.log("INFO", COMPARE_MODULE, "Compared PDFs", {
    beforePdf, afterPdf, beforePages: before.length, afterPages: after.length,
    beforeAreas: changes.before.length, afterAreas: changes.after.length, ms: Date.now() - started,
  });
  return changes;
}
