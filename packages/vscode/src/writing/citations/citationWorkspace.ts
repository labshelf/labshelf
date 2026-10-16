// Gives the citation providers the writing project a file belongs to and the library papers to cite.

import type { Annotation, ILogger, PaperRecord } from "@labshelf/core";
import type { WritingProjects } from "../session/index.js";
import type { CiteSections } from "./citeSectionsCache.js";
import { owningProject, type ProjectLookup, type ReadyProject } from "../mainDocument.js";

export interface CitationSession {
  listPapers(): Promise<PaperRecord[]>;
  /** The paper's annotations; the page-argument completion keeps the highlights that have text. */
  highlightsOf(paperId: string): Promise<Annotation[]>;
  /** Which sections of the project cite each key, from its saved sources. */
  citeSections(project: ReadyProject): Promise<CiteSections>;
  logger: ILogger;
}

/** What the providers read per request: the open library, if any, and the project list. */
export interface CitationWorkspace {
  projects: Pick<WritingProjects, "data" | "list" | "paths" | "reload">;
  session(): CitationSession | undefined;
}

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;

/** The ready project that owns the file as one of its sources; a source in the other format is not one. */
export function citingProject(projects: ProjectLookup, file: string): ReadyProject | undefined {
  const project = owningProject(projects, file);
  return project && projects.paths.extname(file) === SOURCE_EXTENSION[project.settings.format] ? project : undefined;
}
