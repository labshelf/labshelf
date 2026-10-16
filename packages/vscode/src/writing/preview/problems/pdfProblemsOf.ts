// Gathers a built root's problems, places them on the PDF through SyncTeX or Typst cite targets and counts the keys it cites.
import {
  citedKeys, orderPdfProblems, pointFor,
  type ILogger, type LocatedProblem, type PageArea, type PagePoint, type PathOps, type PdfProblem, type SyncIndex, type TypstCite,
} from "@labshelf/core";
import type { ReadyProject } from "../../mainDocument.js";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import type { SynctexLookup } from "../sourceLinks/projectSynctex.js";

export interface PdfProblemsDeps {
  logger: ILogger;
  paths: PathOps;
  problemsOf: (root: string) => readonly LocatedProblem[];
  preprints: (project: ReadyProject) => Promise<{ key: string; message: string; file?: string; line?: number }[]>;
  synctex: () => Promise<SynctexLookup>;
  typstCites: () => readonly TypstCite[];
  readSources: (project: ReadyProject, root: string) => Promise<{ file: string; text: string }[]>;
}

const atPoint = ({ page, x, y }: PagePoint): PageArea => ({ page, left: x, right: x, top: y, bottom: y });

/** A project-relative `/`-separated path; a file outside the project keeps its own path. */
function projectRelative({ paths }: PdfProblemsDeps, folder: string, file: string): string {
  const relative = paths.relative(folder, file);
  return (relative.startsWith("..") || paths.isAbsolute(relative) ? file : relative).split(paths.sep).join("/");
}

/** The SyncTeX index of the root's build; a build without usable data places nothing and the reason is logged once. */
async function syncIndexOf(deps: PdfProblemsDeps, folder: string, root: string): Promise<SyncIndex | undefined> {
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

function latexPlace(deps: PdfProblemsDeps, folder: string, index: SyncIndex | undefined): Place {
  return ({ file, line }) => {
    if (!index || file === undefined || line === undefined) { return undefined; }
    const point = pointFor(index, deps.paths.join(folder, file), line);
    return point && atPoint(point);
  };
}

// Typst reports no source line for a PDF position, so only a citation, found by its key, has a place (D8).
function typstPlace(cites: readonly TypstCite[]): Place {
  return ({ kind, subject }) => {
    if (kind !== "undefinedCitation" && kind !== "preprint") { return undefined; }
    const cite = cites.find((candidate) => candidate.key === subject);
    return cite && atPoint(cite.at);
  };
}

async function citeCount(deps: PdfProblemsDeps, project: ReadyProject, root: string): Promise<number> {
  const keys = new Set<string>();
  for (const { text } of await deps.readSources(project, root)) {
    for (const { key } of citedKeys(project.settings.format, text)) { keys.add(key); }
  }
  return keys.size;
}

export async function pdfProblemsOf(deps: PdfProblemsDeps, project: ReadyProject, root: string): Promise<{ pdfProblems: PdfProblem[]; cites: number }> {
  const build = deps.problemsOf(root).map((problem) => ({ ...problem, file: projectRelative(deps, project.folder, problem.file) }));
  const preprints = (await deps.preprints(project)).map((entry) => (
    entry.file === undefined ? entry : { ...entry, file: projectRelative(deps, project.folder, entry.file) }
  ));
  const typst = project.settings.format === "typst";
  const index = typst || build.length + preprints.length === 0 ? undefined : await syncIndexOf(deps, project.folder, root);
  const place = typst ? typstPlace(deps.typstCites()) : latexPlace(deps, project.folder, index);
  return { pdfProblems: orderPdfProblems({ build, preprints, place }), cites: await citeCount(deps, project, root) };
}
