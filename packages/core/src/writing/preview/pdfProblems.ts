// Places a built root's problems on its PDF, through SyncTeX for LaTeX and through cite targets for Typst, and counts the root's citations.
import type { LocatedProblem } from "../../latex/index.js";
import { deriveProjectPath, type PathOps } from "../../path/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PageArea, PagePoint, PdfProblem } from "../../reader/index.js";
import type { ReadyProject } from "../allProjects/projectLibrary.js";
import { orderPdfProblems } from "../build/index.js";
import { findCiteKeyOccurrences, type TypstCitation } from "../citations/index.js";
import type { SynctexMap } from "../synctexFile.js";
import { findPagePoint } from "../synctexLookup.js";
import { PREVIEW_LOG_MODULE, type SynctexFinder } from "./projectSynctex.js";

export interface PdfProblemsDeps {
  logger: ILogger;
  paths: PathOps;
  problemsOf: (root: string) => readonly LocatedProblem[];
  preprints: (project: ReadyProject) => Promise<{ key: string; message: string; file?: string; line?: number }[]>;
  synctex: () => Promise<SynctexFinder>;
  typstCites: () => readonly TypstCitation[];
  readSources: (project: ReadyProject, root: string) => Promise<{ file: string; text: string }[]>;
}

const atPoint = ({ page, x, y }: PagePoint): PageArea => ({ page, left: x, right: x, top: y, bottom: y });

/** The SyncTeX index of the root's build; a build without usable data places nothing and the reason is logged once. */
async function syncIndexOf(deps: PdfProblemsDeps, folder: string, root: string): Promise<SynctexMap | undefined> {
  try {
    const lookup = await deps.synctex();
    if (lookup.status === "found") { return lookup.index; }
    await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Problems stay unplaced without SyncTeX data", { projectFolder: folder, root, reason: lookup.status });
  } catch (error) {
    await deps.logger.error(PREVIEW_LOG_MODULE, error, { projectFolder: folder, root });
  }
  return undefined;
}

type Place = Parameters<typeof orderPdfProblems>[0]["place"];

function latexPlace(deps: PdfProblemsDeps, folder: string, index: SynctexMap | undefined): Place {
  return ({ file, line }) => {
    if (!index || file === undefined || line === undefined) { return undefined; }
    const point = findPagePoint(index, deps.paths.join(folder, file), line);
    return point && atPoint(point);
  };
}

// Typst reports no source line for a PDF position, so only a citation, found by its key, has a place (D8).
function typstPlace(cites: readonly TypstCitation[]): Place {
  return ({ kind, subject }) => {
    if (kind !== "undefinedCitation" && kind !== "preprint") { return undefined; }
    const cite = cites.find((candidate) => candidate.key === subject);
    return cite && atPoint(cite.at);
  };
}

async function citeCount(deps: PdfProblemsDeps, project: ReadyProject, root: string): Promise<number> {
  const keys = new Set<string>();
  for (const { text } of await deps.readSources(project, root)) {
    for (const { key } of findCiteKeyOccurrences(project.settings.format, text)) { keys.add(key); }
  }
  return keys.size;
}

export async function readPdfProblems(deps: PdfProblemsDeps, project: ReadyProject, root: string): Promise<{ pdfProblems: PdfProblem[]; cites: number }> {
  const build = deps.problemsOf(root).map((problem) => ({ ...problem, file: deriveProjectPath(deps.paths, project.folder, problem.file) }));
  const preprints = (await deps.preprints(project)).map((entry) => (
    entry.file === undefined ? entry : { ...entry, file: deriveProjectPath(deps.paths, project.folder, entry.file) }
  ));
  const typst = project.settings.format === "typst";
  const index = typst || build.length + preprints.length === 0 ? undefined : await syncIndexOf(deps, project.folder, root);
  const place = typst ? typstPlace(deps.typstCites()) : latexPlace(deps, project.folder, index);
  return { pdfProblems: orderPdfProblems({ build, preprints, place }), cites: await citeCount(deps, project, root) };
}
