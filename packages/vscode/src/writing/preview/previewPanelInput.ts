// Describes what a build preview needs from its host and names the paper a preview reader opens.
import type { PaperRecord, PathOps, ProjectDataPort } from "@labshelf/core";
import type { ReaderPanelDeps } from "../../pdf-viewer/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { BuildRootOf } from "../nodePort/index.js";
import type { WritingHost } from "../session/index.js";

export interface BuildPreviewsDeps extends Pick<ReaderPanelDeps, "extensionUri" | "locatePdfjs" | "isMac"> {
  host: Pick<WritingHost, "current">;
  listPapers: () => Promise<PaperRecord[]>;
  paths: PathOps;
  data: ProjectDataPort;
  /** The root the editor file builds into. */
  buildRootOf: BuildRootOf;
  /** Builds a root of the project again. */
  recompile: (projectFolder: string, root: string) => Promise<unknown>;
}

export function previewPaper(paths: PathOps, project: ReadyProject, pdf: string): PaperRecord {
  return { id: `preview:${project.settings.id}`, title: paths.basename(pdf), path: paths.dirname(pdf), citeKey: "", status: "reading" };
}
