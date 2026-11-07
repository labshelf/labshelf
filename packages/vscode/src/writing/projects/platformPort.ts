// Declares what the platform's Writing registrations need and what they hand back: the builders and the project history.
import type * as vscode from "vscode";

import type { ReaderPanelDeps } from "../../reader/index.js";
import type { BuildProblems, BuildListener, FindIncludeOnly, ProjectBuilders } from "../build/index.js";
import type { ProjectFigures } from "./projectFigures.js";
import type { ReadyProject } from "./commands.js";
import type { BuildPreviews } from "../preview/index.js";
import type { WritingHost, WritingProjects } from "./session.js";
import type { ActiveSource } from "../activeSource.js";
import type { StylePreviewServices } from "../sourceEditor/deckStylePreview.js";

interface PlatformWritingDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
  /** The focused source editor, native or LabShelf. */
  activeSource: ActiveSource;
  figures: ProjectFigures;
  /** Hears every build and answers whether a project has a preview open. */
  previews: BuildListener & Pick<BuildPreviews, "hasPreview">;
  diagnostics: BuildProblems;
  reader: Omit<ReaderPanelDeps, "logger" | "extensionUri">;
  /** What a save builds alone while the include-only toggle is on. */
  includeOnlyTarget?: FindIncludeOnly;
  /** Hears the finding count of every check run. */
  onFindings?(folder: string, count: number): void;
}

/** Project-relative root that a save or build of `file` (absolute) targets: the file when it is a root, else `main`. */
export type BuildRootOf = (projectFolder: string, main: string, file: string) => Promise<string>;

/** What the rest of the Writing view records into a project's history. */
export interface ProjectHistoryRecorder {
  recordVersion(project: ReadyProject, name: string): void;
}

export interface PlatformWriting {
  builders: ProjectBuilders;
  /** Absent where the project history is not kept. */
  history?: ProjectHistoryRecorder;
  /** The TeX and Typst the builds run on, shared with other compiles; absent where nothing compiles in the extension. */
  compilers?: Pick<StylePreviewServices, "tex" | "typst">;
}

export type RegisterPlatformWriting = (deps: PlatformWritingDeps) => PlatformWriting;
