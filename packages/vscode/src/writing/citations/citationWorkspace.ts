// Gives the citation providers the writing project a file belongs to and the library papers to cite.
import * as path from "node:path";

import type { ILogger, PaperRecord } from "@labshelf/core";
import type { WritingProjects } from "../projectStore.js";
import { owningProject, type ReadyProject } from "../mainDocument.js";

interface CitationSession {
  listPapers(): Promise<PaperRecord[]>;
  logger: ILogger;
}

/** What the providers read per request: the open library, if any, and the project list. */
export interface CitationWorkspace {
  projects: Pick<WritingProjects, "list" | "reload">;
  session(): CitationSession | undefined;
}

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;

/** The ready project that owns the file as one of its sources; a source in the other format is not one. */
export function citingProject(projects: Pick<WritingProjects, "list">, file: string): ReadyProject | undefined {
  const project = owningProject(projects.list(), file);
  return project && path.extname(file) === SOURCE_EXTENSION[project.settings.format] ? project : undefined;
}
