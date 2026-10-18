/** Declares the whole-project LaTeX helper calls the web build makes to its editor page. */
// CONTRACT: documents/contracts/editor-host.md#latex-helper

import type { LocatedProblem, TexInstallKind } from "../../latex/index.js";
import type { LatexEngine } from "../../project/index.js";
import type { HelperBuildStatus } from "../helperMessages.js";
import type { HelperProgressListener, HelperStatus } from "../latexHelper.js";

export interface EditorHostProjectFile { path: string; bytes: Uint8Array }

export interface EditorHostProject {
  projectId: string;
  main: string;
  engine: LatexEngine;
  files: readonly EditorHostProjectFile[];
}

export type EditorHostCompileResult =
  | { status: "succeeded"; problems: LocatedProblem[]; pdf: Uint8Array }
  | { status: Exclude<HelperBuildStatus, "succeeded">; problems: LocatedProblem[] };

export interface EditorHostLatexHelper {
  connect(): Promise<HelperStatus>;
  status(): HelperStatus | undefined;
  /** Syncs the project's files, builds it, and returns the outcome with the PDF bytes on success. */
  compile(project: EditorHostProject, onProgress: HelperProgressListener): Promise<EditorHostCompileResult>;
  cancel(projectId: string): Promise<void>;
  installTex(kind: TexInstallKind, onProgress: HelperProgressListener): Promise<void>;
  installAllPackages(onProgress: HelperProgressListener): Promise<void>;
}
