// Declares what the Node-only Writing registrations need and the function that performs them.
import type * as vscode from "vscode";

import type { ReaderPanelDeps } from "../../pdf-viewer/index.js";
import type { BuildDiagnostics, ProjectBuilders } from "../build/index.js";
import type { ProjectFigures } from "../figures/index.js";
import type { BuildPreviews } from "../preview/index.js";
import type { WritingHost, WritingProjects } from "../index.js";

interface NodeWritingDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
  figures: ProjectFigures;
  previews: BuildPreviews;
  diagnostics: BuildDiagnostics;
  reader: Omit<ReaderPanelDeps, "logger" | "extensionUri">;
}

export type RegisterNodeWriting = (deps: NodeWritingDeps) => { builders: ProjectBuilders };
