// Declares a writing project as the All projects page lists it, independent of where the host stores it.
import type { ProjectFormat } from "../project/index.js";

/** The page keeps each place apart: archived and trashed projects never mix with the others. */
export type ProjectPlace = "projects" | "archived" | "trash";

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
  openItems?: number;
  /** The project lives outside the library, so deleting it forever only removes it from LabShelf. */
  external?: boolean;
  /** Why the project cannot be read. */
  broken?: string;
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
