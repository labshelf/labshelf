// Declares a writing project as the All projects page lists it, independent of where the host stores it.
import type { ProjectFormat, ProjectTarget } from "../project/index.js";

/** The page keeps each place apart: archived and trashed projects never mix with the others. */
export type ProjectPlace = "projects" | "archived" | "trash";

/** `earlier` is a PDF from before this session (`at` is its mtime); `never` is no PDF and no outcome. */
export type ProjectBuildState = "ok" | "warnings" | "failed" | "building" | "earlier" | "never";

export interface BuildMark {
  state: ProjectBuildState;
  /** Epoch ms of the outcome, or of the PDF for `earlier`. */
  at?: number;
}

export type NewProjectKind = "blank" | "template" | "folder";

export interface ProjectRow {
  /** The host's key for the project: a folder path in VS Code, the project id in the browser. */
  id: string;
  title: string;
  /** Absent when the project's labshelf.yaml cannot be read. */
  format?: ProjectFormat;
  /** Sidebar folder, segments joined by "/"; absent at the top level. */
  folder?: string;
  place: ProjectPlace;
  /** Epoch ms of the newest source file. */
  modified?: number;
  /** ISO time the project went to the trash. */
  trashedAt?: string;
  /** Distinct keys the project cites. */
  cites?: number;
  /** Cited keys found neither in the library nor in the project's bibliography. */
  unresolvedCites?: number;
  build?: BuildMark;
  target?: ProjectTarget;
  /** The project lives outside the library, so deleting it forever only removes it from LabShelf. */
  external?: boolean;
  /** Why the project cannot be read. */
  broken?: string;
  /** The project carries a share id, so this device joined or shared it. */
  shared?: boolean;
  /** The main file, relative to the project folder and "/"-separated. */
  main?: string;
}

/** A host-specific action on a project row, such as "Reveal in Finder". */
export interface ProjectMenuCommand {
  command: string;
  label: string;
  /** Rows of the same group sit together between separators. */
  group: number;
  externalOnly?: boolean;
}
