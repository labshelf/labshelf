// Records the Typst version a project was last built with in labshelf.yaml and warns when it differs from the one LabShelf compiles with.
import * as vscode from "vscode";

import { TYPST_VERSION } from "@labshelf/core/typst";
import type { ReadyProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";

const MODULE = "writing/typst";

interface VersionPinDeps {
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "data" | "reload">;
}

/** Folders already warned about in this session, so a project warns once however often it builds. */
const warnedFolders = new Set<string>();

function warnOnce(project: ReadyProject, recorded: string): void {
  if (warnedFolders.has(project.folder)) { return; }
  warnedFolders.add(project.folder);
  void vscode.window.showWarningMessage(
    `Project "${project.settings.id}" was last built with Typst ${recorded}; LabShelf compiles it with Typst ${TYPST_VERSION}. Check the PDF for differences.`,
  );
}

/** Called after every successful Typst build; writes labshelf.yaml only when the recorded version differs. */
export async function recordTypstVersion(project: ReadyProject, deps: VersionPinDeps): Promise<void> {
  const recorded = project.settings.typst;
  if (recorded === TYPST_VERSION) { return; }
  const logger = deps.host.current()?.logger;
  if (recorded !== undefined) { warnOnce(project, recorded); }
  if (!logger) { return; }
  try {
    await deps.projects.data.updateProjectSettings(project.folder, { typst: TYPST_VERSION });
    await deps.projects.reload();
  } catch (error) {
    await logger.error(MODULE, error, { action: "record-typst-version", folder: project.folder });
  }
}
