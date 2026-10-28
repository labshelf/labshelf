// Reads what the All projects detail pane shows for one project, and the build summary and cites its list shows, from the core readers.
import { formatError } from "../../errors/index.js";
import type { PdfjsLoader } from "../../import/index.js";
import { readLatexProjectTexts } from "../../latex/index.js";
import { formatAuthors } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { ILogger } from "../../ports/index.js";
import { deriveCountedPages, derivePaperBody, readPdfFacts, countWordsUpTo, deriveReadingOrderTexts } from "../checks/index.js";
import { BIBLIOGRAPHY_HEADER, derivePapersByCiteKey, parseBibEntries, scanCiteKeys } from "../citations/index.js";
import {
  DEFAULT_BIBLIOGRAPHY, listBuildRootFileNames, listVersions, readOptionalText, type ProjectReadContext, type ProjectSettings,
  type ReadyProject,
} from "../project/index.js";
import type { BuildProblem, BuildSources, ProjectLibraryDeps } from "./projectLibrary.js";
import type { ProjectBuildReport, ProjectCitation, ProjectPaneContent } from "./projectModel.js";

interface ProjectSourceTexts {
  /** Project-relative paths, main first. */
  paths: string[];
  /** The texts in reading order, each include placed where it is written. */
  texts: { text: string }[];
}

/** A LaTeX project reads its include tree; a Typst project reads its main file alone. A missing main file gives no sources. */
async function readProjectSources(
  { fs, paths }: ProjectReadContext, folder: string, settings: ProjectSettings,
): Promise<ProjectSourceTexts> {
  const main = settings.main;
  if (main === undefined) { return { paths: [], texts: [] }; }
  const read = (relativePath: string): Promise<string | undefined> => readOptionalText(fs, paths.join(folder, relativePath));
  if (settings.format === "typst") {
    const text = await read(main);
    return text === undefined ? { paths: [], texts: [] } : { paths: [main], texts: [{ text }] };
  }
  const { files, texts } = await readLatexProjectTexts(main, { read });
  return { paths: files.map((file) => file.path), texts: deriveReadingOrderTexts(files, texts) };
}

/** Keys of the root .bib files and of the project's bibliography file. */
async function bibKeys(context: ProjectReadContext, folder: string, settings: ProjectSettings): Promise<Set<string>> {
  const { fs, paths } = context;
  const roots = (await listBuildRootFileNames(context, folder)).filter((name) => name.endsWith(".bib"));
  const files = new Set([...roots, settings.bibliography ?? DEFAULT_BIBLIOGRAPHY].map((file) => paths.join(folder, file)));
  const texts = await Promise.all([...files].map((file) => readOptionalText(fs, file)));
  return new Set(texts.flatMap((text) => (text === undefined ? [] : parseBibEntries(text).map((entry) => entry.key))));
}

function libraryCitation(paper: PaperRecord): ProjectCitation {
  const authors = formatAuthors(paper.authors);
  return {
    key: paper.citeKey, source: "library", paperId: paper.id, title: paper.title,
    ...(authors === "" ? {} : { authors }), ...(paper.year === undefined ? {} : { year: String(paper.year) }),
  };
}

/** One entry per distinct cited key, in key order. Rejects when a .bib file cannot be read. */
async function deriveProjectCitations(
  context: ProjectReadContext, folder: string, settings: ProjectSettings, sources: ProjectSourceTexts, papers: readonly PaperRecord[],
): Promise<ProjectCitation[]> {
  const keys = [...new Set(sources.texts.flatMap(({ text }) => scanCiteKeys(settings.format, text)))].sort();
  const library = derivePapersByCiteKey(papers);
  const bib = keys.some((key) => !library.has(key)) ? await bibKeys(context, folder, settings) : new Set<string>();
  return keys.map((key) => {
    const paper = library.get(key);
    if (paper !== undefined) { return libraryCitation(paper); }
    return { key, source: bib.has(key) ? "bib" : "none" };
  });
}

export async function readProjectCitations(
  context: ProjectReadContext, folder: string, settings: ProjectSettings, papers: readonly PaperRecord[],
): Promise<{ cites: number; unresolved: number }> {
  const citations = await deriveProjectCitations(context, folder, settings, await readProjectSources(context, folder, settings), papers);
  return { cites: citations.length, unresolved: citations.filter((citation) => citation.source === "none").length };
}

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

function problemsOf({ builds }: BuildSources, folder: string): BuildProblem[] {
  return [...builds.builtRoots(folder)].flatMap((root) => builds.problemsOf(folder, root) ?? []);
}

export async function deriveBuildReport(sources: BuildSources, project: ReadyProject): Promise<ProjectBuildReport> {
  const { folder } = project;
  const problems = problemsOf(sources, folder).filter((problem) => problem.severity !== "info");
  const errors = problems.filter((problem) => problem.severity === "error").length;
  const warnings = problems.length - errors;
  const [head] = problems;
  const counts = { warnings, errors, ...(head ? { first: { message: head.message, ...(head.file ? { file: head.file } : {}), ...(head.line === undefined ? {} : { line: head.line }) } } : {}) };
  const outcome = sources.outcomes.last(folder);
  // A root's first build has no recorded problems yet, so the main root is checked as well as the built ones.
  const roots = new Set([...sources.builds.builtRoots(folder), ...(project.main ? [project.main] : [])]);
  const building = [...roots].some((root) => sources.builds.stateOf(folder, root)?.state === "building");
  if (building) { return { state: "building", ...(outcome ? { at: outcome.at.getTime() } : {}), ...counts }; }
  if (outcome) {
    const state = !outcome.ok ? "failed" : warnings > 0 ? "warnings" : "ok";
    return { state, at: outcome.at.getTime(), ...counts };
  }
  const modified = await sources.pdfModified(project);
  return modified === undefined ? { state: "never", ...counts } : { state: "earlier", at: modified, ...counts };
}

interface ProjectCites { cites: number; unresolved: number }

interface ProjectPaneSource {
  build(project: ReadyProject): Promise<ProjectBuildReport>;
  /** Undefined when the sources cannot be read; the failure is logged. */
  cites(project: ReadyProject, modified: number | undefined): Promise<ProjectCites | undefined>;
  detail(project: ReadyProject): Promise<ProjectPaneContent>;
}

// The core readers take the main file from `settings.main`; the entry's main may be a detected one.
const withMain = (project: ReadyProject): ReadyProject["settings"] => ({ ...project.settings, ...(project.main ? { main: project.main } : {}) });

export function createProjectPaneSource(deps: ProjectLibraryDeps): ProjectPaneSource {
  const { fs, paths, logger, locate } = deps;
  const context = { fs, paths, logger };
  const pdfModified = async (project: ReadyProject): Promise<number | undefined> => {
    const pdf = await locate.pdf(project);
    return pdf === undefined ? undefined : (await fs.stat(pdf))?.mtimeMs;
  };
  const build = (project: ReadyProject): Promise<ProjectBuildReport> => deriveBuildReport({ ...deps, pdfModified }, project);
  // Reading the sources walks the project, so a count is kept until the project's modified time changes.
  const cached = new Map<string, { modified: number; value: ProjectCites }>();

  return {
    build,
    async cites(project, modified) {
      const hit = cached.get(project.folder);
      if (modified !== undefined && hit?.modified === modified) { return hit.value; }
      try {
        const { cites, unresolved } = await (deps.readers?.citations ?? readProjectCitations)(context, project.folder, withMain(project), await deps.listPapers());
        const value = { cites, unresolved };
        if (modified !== undefined) { cached.set(project.folder, { modified, value }); }
        return value;
      } catch (error) {
        await logger.log("WARN", "writing.allProjects", "could not read the cites of a project", {
          folder: project.folder, error: formatError(error),
        });
        return undefined;
      }
    },
    async detail(project) {
      const [papers, summary, pdf, log] = await Promise.all([
        deps.listPapers(), build(project), locate.pdf(project), project.main ? locate.rawLog(project, project.main) : undefined,
      ]);
      return (deps.readers?.paneContent ?? readProjectPaneContent)(context, {
        id: project.folder, folder: project.folder, settings: withMain(project), papers, build: summary, pdf, log, pdfjs: deps.pdfjs,
      });
    },
  };
}
