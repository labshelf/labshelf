// Declares the project storage operations a host implements for the All projects page.
import type { ProjectTarget } from "../project/index.js";
import type { ProjectDetail } from "./projectDetail.js";
import type { NewProjectKind, ProjectMenuCommand, ProjectRow } from "./projectRow.js";

/** Every `id` is a ProjectRow id; the implementation binds the logger and the library. */
export interface ProjectLibraryPort {
  list(): Promise<ProjectRow[]>;
  /** Returns the function that stops listening. */
  onDidChange(listener: () => void): () => void;
  commands(): ProjectMenuCommand[];
  open(id: string): Promise<void>;
  create(kind: NewProjectKind): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  duplicate(id: string, title: string): Promise<void>;
  move(id: string, folder: string | undefined): Promise<void>;
  setArchived(id: string, archived: boolean): Promise<void>;
  setTrashed(id: string, trashed: boolean): Promise<void>;
  /** Deletes a library project's folder; an external project is only removed from LabShelf. */
  deleteForever(id: string): Promise<void>;
  runCommand(id: string, command: string): Promise<void>;
  /** Every file of the project, relative to its folder, "/"-separated and sorted. */
  files(id: string): Promise<string[]>;
  /** Opens one of `files(id)`, opening the project first when another one is open. */
  openFile(id: string, path: string): Promise<void>;
  detail(id: string): Promise<ProjectDetail>;
  build(id: string): Promise<void>;
  /** Opens the project's last PDF. */
  preview(id: string): Promise<void>;
  /** Opens the last LaTeX log. */
  openLog(id: string): Promise<void>;
  /** Creates an empty file at a project-relative `path`, then opens it. */
  createFile(id: string, path: string): Promise<void>;
  /** Writes the project's `target` to labshelf.yaml; `null` removes it. */
  setTarget(id: string, target: ProjectTarget | null): Promise<void>;
  /** The host's name for opening a project in its editor, such as "Open in VS Code". */
  openLabel(): string;
}
