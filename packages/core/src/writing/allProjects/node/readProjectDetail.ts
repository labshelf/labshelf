// Reads what the All projects detail pane shows for one project from its folder, built PDF and the library papers.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { PdfjsLoader } from "../../../import/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger } from "../../../ports/index.js";
import { countedPages, paperBody, wordsUpTo } from "../../checks/index.js";
import { readPdfFacts } from "../../checks/node/index.js";
import type { ProjectSettings } from "../../project/index.js";
import { listVersions } from "../../versions/node/index.js";
import type { ProjectBuildSummary, ProjectDetail } from "../projectDetail.js";
import { bibliographySummary } from "./bibliographySummary.js";
import { projectCitations } from "./projectCitations.js";
import { readProjectSources } from "./readProjectSources.js";

const MODULE = "writing/allProjects";

export interface ProjectDetailRequest {
  id: string;
  folder: string;
  settings: ProjectSettings;
  papers: readonly PaperRecord[];
  build: ProjectBuildSummary;
  /** The last built PDF. */
  pdf?: string | undefined;
  /** The last LaTeX log file. */
  log?: string | undefined;
  pdfjs: PdfjsLoader;
}

/** A part that cannot be read is logged with the folder and left out, so the rest of the detail still shows. */
async function part<T>(logger: ILogger, folder: string, name: string, read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    await logger.log("WARN", MODULE, `Could not read the ${name} of a project`, {
      folder, part: name, error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

async function pdfPages(pdfjs: PdfjsLoader, pdf: string, countUpTo: "references" | "end"): Promise<{ pages: number; counted: number }> {
  const { pages } = await readPdfFacts(pdfjs, pdf);
  return { pages: pages.length, counted: countedPages(paperBody(pages.map((page) => page.lines)), pages.length, countUpTo).pages };
}

async function logName(log: string): Promise<string | undefined> {
  return (await fs.stat(log).then(() => true, () => false)) ? path.basename(log) : undefined;
}

export async function readProjectDetail(request: ProjectDetailRequest, logger: ILogger): Promise<ProjectDetail> {
  const { id, folder, settings, papers, build } = request;
  const countUpTo = settings.check?.countUpTo ?? "references";
  const read = <T>(name: string, reader: () => Promise<T>): Promise<T | undefined> => part(logger, folder, name, reader);
  const sources = (await read("sources", () => readProjectSources(folder, settings))) ?? { paths: [], texts: [] };
  const [pdf, citations, bibliography, versions, log] = await Promise.all([
    request.pdf === undefined ? undefined : read("PDF", () => pdfPages(request.pdfjs, request.pdf!, countUpTo)),
    read("citations", () => projectCitations(folder, settings, sources, papers)),
    read("bibliography", () => bibliographySummary(folder, settings)),
    read("versions", () => listVersions(folder, logger)),
    request.log === undefined ? undefined : read("log", () => logName(request.log!)),
  ]);
  const engine = settings.format === "typst" ? (settings.typst === undefined ? undefined : `Typst ${settings.typst}`) : settings.engine;
  const check = settings.check;
  return {
    id, location: folder, build,
    ...(engine === undefined ? {} : { engine }),
    ...(pdf === undefined ? {} : { pages: pdf.pages }),
    limits: {
      countUpTo,
      ...(pdf === undefined ? {} : { pages: { counted: pdf.counted, ...(check?.pages === undefined ? {} : { limit: check.pages }) } }),
      words: { counted: wordsUpTo(sources.texts, countUpTo), ...(check?.words === undefined ? {} : { limit: check.words }) },
    },
    ...(log === undefined ? {} : { log }),
    ...(bibliography === undefined ? {} : { bibliography }),
    citations: citations ?? [],
    versions: (versions ?? []).map(({ name, created }) => ({ name, created })).reverse(),
    sources: sources.paths,
  };
}
