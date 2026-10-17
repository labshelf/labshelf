// Describes what a build preview needs from its host and names the paper a preview reader opens.
import type { Annotation, LatexEngine, PaperRecord, PathOps, ProjectDataPort } from "@labshelf/core";
import type { ReaderPanelDeps } from "../../pdf-viewer/index.js";
import type { ReadyProject } from "../mainDocument.js";
import type { IncludeOnlyState } from "../build/node/index.js";
import type { CitationFixDeps } from "./citationFixes/index.js";
import type { BuildRootOf } from "../nodePort/index.js";
import type { WritingHost, WritingProjects } from "../session/index.js";
import type { CheckCounts } from "./limits/index.js";

export interface BuildPreviewsDeps extends Pick<ReaderPanelDeps, "extensionUri" | "locatePdfjs" | "isMac"> {
  host: Pick<WritingHost, "current">;
  listPapers: () => Promise<PaperRecord[]>;
  highlightsOf: (paperId: string) => Promise<Annotation[]>;
  paths: PathOps;
  data: ProjectDataPort;
  /** The root the editor file builds into. */
  buildRootOf: BuildRootOf;
  /** Builds a root of the project again. */
  recompile: (projectFolder: string, root: string) => Promise<unknown>;
  /** The open projects; the preview sends its roots again when they reload. */
  projects: Pick<WritingProjects, "list" | "onDidChange" | "data" | "paths" | "reload">;
  /** The finding count of each project's last check. */
  checkCounts: CheckCounts;
  /** Stores the engine a LaTeX project builds with. */
  setEngine: (project: ReadyProject, engine: LatexEngine) => Promise<void>;
  /** The citation-card fixes for a project folder; undefined while no library is open. */
  fixes: (projectFolder: string) => CitationFixDeps | undefined;
  /** Offers the include-only toggle and the toolbar's project actions; absent where builds cannot run. */
  includeOnly?: Pick<IncludeOnlyState, "option" | "set">;
}

export function previewPaper(paths: PathOps, project: ReadyProject, pdf: string): PaperRecord {
  return { id: `preview:${project.settings.id}`, title: paths.basename(pdf), path: paths.dirname(pdf), citeKey: "", status: "reading" };
}
