// Declares what the Writing tab needs from its app: the projects to show and how to open their PDFs, papers and editor.
import type { ProjectFormat, ProjectLocation } from "../../../writing/project/index.js";
import type { ReadingListEntry } from "../../../writing/readingList/index.js";

export type WritingTabProject =
  | {
    kind: "ready";
    id: string;
    /** The shown name: `title ?? id`. */
    name: string;
    format: ProjectFormat;
    location: ProjectLocation;
    /** The built PDF, relative to the project folder; undefined when the project has none yet. */
    pdf: string | undefined;
    readingList: ReadingListEntry[];
  }
  | { kind: "broken"; folder: string; location: ProjectLocation; reason: string };

export interface WritingTabHost {
  listProjects(): Promise<WritingTabProject[]>;
  openPdf(projectId: string, pdf: string): void;
  openPaper(paperId: string): void;
  /** Opens the project's files in the app's editor. */
  editProject(projectId: string): void;
}
