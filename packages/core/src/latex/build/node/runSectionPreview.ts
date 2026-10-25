/** Previews an edit by typesetting its section alone on the preamble format and swapping its pages into the last shown PDF. */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";

import { readOptionalFile, writeFileAtomic } from "../../../library/node/index.js";
import { collectProjectSources } from "../../source/index.js";
import type { LatexBuildResult } from "../index.js";
import { latexPreviewCommand } from "../index.js";
import {
  assembleSectionDocument, definitionsBeforeSection, filterAuxForSection, mapSectionProblems, planSectionPreview, sectionPageRange,
  type SectionState,
} from "../section/index.js";
import { readSectionStates, swapSectionPages } from "../section/node/index.js";
import { compileLatex } from "./compileLatex.js";
import type { ProblemPlaces } from "./findProblems.js";
import { mainFolderPath } from "./buildRootPath.js";
import { preambleFormat } from "./buildPreambleFormat.js";
import { withIncludeOnlyFile } from "./includeOnlyFile.js";
import type { LatexBuildRequest } from "./runLatexBuild.js";

const MODULE = "writing/build";

/** The PDF the build folder last produced for display: a full build's, or a section preview's swapped into it. */
export function shownPdfName(base: string): string {
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
  await collectProjectSources(path.basename(request.main), {
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
  const states = await readSectionStates(request.outDir, base, request.logger);
  const hasAux = await fs.stat(path.join(request.outDir, `${base}.aux`)).then(() => true, () => false);
  const plan = planSectionPreview({
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
  await writeFileAtomic(path.join(request.outDir, `${base}-section.aux`), filterAuxForSection(aux));
  const document = assembleSectionDocument({
    formatName, state: job.states[job.sectionIndex]!,
    definitions: definitionsBeforeSection({ sources: job.sources, main: path.basename(request.main), editedFile: job.edited, startLine: job.startLine }),
    sectionText: job.sources[job.edited]!.split("\n").slice(job.startLine, job.endLine).join("\n"),
  });
  await writeFileAtomic(path.join(request.outDir, `${base}-section.tex`), document.text);
  return document.headerLines;
}

/** The swapped PDF goes to the build folder, the shown copy and next to main. */
async function publishSwap(request: LatexBuildRequest, places: ProblemPlaces, base: string, job: SectionJob, sectionPdf: string): Promise<string | undefined> {
  const shown = await fs.readFile(path.join(request.outDir, shownPdfName(base))).catch(() => undefined);
  if (!shown) return fallBack(request, "no-shown-pdf");
  const section = await fs.readFile(sectionPdf);
  const pageCount = (await PDFDocument.load(shown, { updateMetadata: false })).getPageCount();
  const swapped = await swapSectionPages(shown, section, sectionPageRange(job.states, job.sectionIndex, pageCount));
  if (!swapped) return fallBack(request, "section-page-count-changed");
  const pdf = path.join(places.workDir, `${base}.pdf`);
  for (const file of [path.join(request.outDir, `${base}.pdf`), path.join(request.outDir, shownPdfName(base)), pdf]) {
    await writeFileAtomic(file, swapped);
  }
  return pdf;
}

/** The section preview's result, or none after logging why the document preview runs instead. */
export async function runSectionPreview(request: LatexBuildRequest, places: ProblemPlaces, base: string): Promise<LatexBuildResult | undefined> {
  const job = await planJob(request, places, base);
  if (typeof job === "string") { return fallBack(request, job); }
  const found = await preambleFormat({ ...request, mainPath: places.mainFile });
  if (!found) { return fallBack(request, "no-format"); }
  const headerLines = await writeSectionDocument(request, base, job, found.name);
  const documentName = `${base}-section.tex`;
  const command = latexPreviewCommand(request.toolchain.engine, documentName, request.outDir, {
    format: { name: found.name, searchPath: `${found.dir}${path.delimiter}` },
    ...(request.haltOnError !== undefined && { haltOnError: request.haltOnError }),
  });
  const result = await withIncludeOnlyFile(request.outDir, undefined, () => compileLatex(request, places, {
    job: `${base}-section`, command,
    mapProblems: (problems) => mapSectionProblems(problems, { documentName, editedFile: job.edited, headerLines, startLine: job.startLine }),
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
