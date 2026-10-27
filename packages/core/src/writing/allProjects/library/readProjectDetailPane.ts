// Reads what the All projects detail pane shows for one project from its folder, built PDF and the library papers.
import type { PdfjsLoader } from "../../../import/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { ILogger } from "../../../ports/index.js";
import { deriveCountedPages, derivePaperBody, readPdfFacts, countWordsUpTo } from "../../checks/index.js";
import { type ProjectSettings, DEFAULT_BIBLIOGRAPHY } from "../../project/index.js";
import { type ProjectReadContext, readOptionalText } from "../../project/projectReads.js";
import { listVersions } from "../../versions/index.js";
import type { ProjectBuildReport, ProjectPaneContent } from "../projectDetailPane.js";
import { deriveProjectCitations } from "./deriveProjectCitations.js";
import { readProjectSources } from "./readProjectSources.js";
import { parseBibEntries } from "../../bibliography/index.js";
import { BIBLIOGRAPHY_HEADER } from "../../citations/index.js";
import { formatError } from "../../../errors/index.js";

/** Undefined when the project has no bibliography file yet. */
async function bibliographySummary(
  { fs, paths }: ProjectReadContext, folder: string, settings: ProjectSettings,
): Promise<ProjectPaneContent["bibliography"]> {
  const file = settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  const absolute = paths.join(folder, file);
  const text = await readOptionalText(fs, absolute);
  if (text === undefined) { return undefined; }
  const mtimeMs = (await fs.stat(absolute))?.mtimeMs ?? 0;
  return {
    file, entries: parseBibEntries(text).length, generated: text.split(/\r?\n/, 1)[0] === BIBLIOGRAPHY_HEADER, written: Math.round(mtimeMs),
  };
}

const MODULE = "writing/allProjects";

export interface ProjectPaneRequest {
  id: string;
  folder: string;
  settings: ProjectSettings;
  papers: readonly PaperRecord[];
  build: ProjectBuildReport;
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
      folder, part: name, error: formatError(error),
    });
    return undefined;
  }
}

async function pdfPages({ fs }: ProjectReadContext, pdfjs: PdfjsLoader, pdf: string, countUpTo: "references" | "end"): Promise<{ pages: number; counted: number }> {
  const { pages } = await readPdfFacts(fs, pdfjs, pdf);
  return { pages: pages.length, counted: deriveCountedPages(derivePaperBody(pages.map((page) => page.lines)), pages.length, countUpTo).pages };
}

async function logName({ fs, paths }: ProjectReadContext, log: string): Promise<string | undefined> {
  return (await fs.stat(log)) === undefined ? undefined : paths.basename(log);
}

export async function readProjectPaneContent(context: ProjectReadContext, request: ProjectPaneRequest): Promise<ProjectPaneContent> {
  const { id, folder, settings, papers, build } = request;
  const countUpTo = settings.check?.countUpTo ?? "references";
  const read = <T>(name: string, reader: () => Promise<T>): Promise<T | undefined> => part(context.logger, folder, name, reader);
  const sources = (await read("sources", () => readProjectSources(context, folder, settings))) ?? { paths: [], texts: [] };
  const [pdf, citations, bibliography, versions, log] = await Promise.all([
    request.pdf === undefined ? undefined : read("PDF", () => pdfPages(context, request.pdfjs, request.pdf!, countUpTo)),
    read("citations", () => deriveProjectCitations(context, folder, settings, sources, papers)),
    read("bibliography", () => bibliographySummary(context, folder, settings)),
    read("versions", () => listVersions(context, folder)),
    request.log === undefined ? undefined : read("log", () => logName(context, request.log!)),
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
      words: { counted: countWordsUpTo(sources.texts, countUpTo), ...(check?.words === undefined ? {} : { limit: check.words }) },
    },
    ...(log === undefined ? {} : { log }),
    ...(bibliography === undefined ? {} : { bibliography }),
    citations: citations ?? [],
    versions: (versions ?? []).map(({ name, created }) => ({ name, created })).reverse(),
    sources: sources.paths,
  };
}
