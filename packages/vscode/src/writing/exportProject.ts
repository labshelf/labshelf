// Runs the project's export actions: saves its PDF, its source or an arXiv bundle as a zip, or a pandoc document, or opens the PDF in the system viewer.
import { zipSync } from "fflate";
import * as vscode from "vscode";

import { DOCUMENT_EXPORT_EXTENSIONS, type DocumentExport, type ILogger, type ProjectFormat } from "@labshelf/core";

import type { ReadyProject } from "./buildRootDocument.js";
import { readBuiltPdf } from "./preview/readBuiltPdf.js";
import type { WritingProjects } from "./session/index.js";
import { listArxivZipEntries, listProjectZipEntries } from "./exportBundle.js";

const MODULE = "writing.export";

export type ExportTarget = "pdf" | "systemViewer" | "projectZip" | "arxivZip" | DocumentExport;

/** Converts a project root to a document; pandoc on the desktop. */
export type ConvertDocument = (request: { format: ProjectFormat; folder: string; main: string; target: DocumentExport; output: string }) => Promise<void>;

export interface ExportProjectDeps {
  logger: ILogger;
  projects: Pick<WritingProjects, "data" | "paths" | "fs">;
  /** Absent where documents cannot be converted, which leaves the document targets unregistered. */
  convertDocument?: ConvertDocument;
}

const DOCUMENT_FILTERS: Record<DocumentExport, string> = { docx: "Word", markdown: "Markdown", html: "HTML" };

/** Asks where to save, starting in the project folder at `<project id><suffix>.<extension>`; undefined when cancelled. */
async function askDestination(project: ReadyProject, suffix: string, extension: string, filter: string): Promise<vscode.Uri | undefined> {
  return await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(project.folder), `${project.settings.id}${suffix}.${extension}`),
    filters: { [filter]: [extension] },
  });
}

async function withBuiltPdf(deps: ExportProjectDeps, project: ReadyProject, root: string, use: (pdf: string) => PromiseLike<unknown>): Promise<void> {
  const pdf = await readBuiltPdf(deps.projects, project, root);
  if (!pdf) {
    void vscode.window.showInformationMessage(`Build ${root} to get its PDF.`);
    return;
  }
  await use(pdf);
}

async function saveZip(deps: ExportProjectDeps, project: ReadyProject, root: string, target: "projectZip" | "arxivZip"): Promise<void> {
  const destination = await askDestination(project, target === "arxivZip" ? "-arxiv" : "", "zip", "Zip");
  if (!destination) { return; }
  const entries = target === "arxivZip"
    ? await listArxivZipEntries(deps.projects.paths, project, root)
    : await listProjectZipEntries(deps.projects.paths, project);
  await vscode.workspace.fs.writeFile(destination, zipSync(entries));
}

async function saveDocument(deps: ExportProjectDeps, project: ReadyProject, root: string, target: DocumentExport): Promise<void> {
  if (!deps.convertDocument) { throw new Error(`Exporting to ${DOCUMENT_FILTERS[target]} is not available here.`); }
  const destination = await askDestination(project, "", DOCUMENT_EXPORT_EXTENSIONS[target], DOCUMENT_FILTERS[target]);
  if (!destination) { return; }
  await deps.convertDocument({ format: project.settings.format, folder: project.folder, main: root, target, output: destination.fsPath });
}

async function run(deps: ExportProjectDeps, project: ReadyProject, root: string, target: ExportTarget): Promise<void> {
  switch (target) {
    case "pdf": return await withBuiltPdf(deps, project, root, async (pdf) => {
      const destination = await askDestination(project, "", "pdf", "PDF");
      if (destination) { await vscode.workspace.fs.copy(vscode.Uri.file(pdf), destination, { overwrite: true }); }
    });
    case "systemViewer": return await withBuiltPdf(deps, project, root, (pdf) => vscode.env.openExternal(vscode.Uri.file(pdf)));
    case "projectZip": case "arxivZip": return await saveZip(deps, project, root, target);
    default: return await saveDocument(deps, project, root, target);
  }
}

/** Exports the project for the target; a cancelled save dialog does nothing and a failure is logged and shown. */
export async function exportProject(deps: ExportProjectDeps, project: ReadyProject, root: string, target: ExportTarget): Promise<void> {
  try {
    await run(deps, project, root, target);
  } catch (error) {
    await deps.logger.error(MODULE, error, { project: project.settings.id, root, target });
    void vscode.window.showErrorMessage(`Could not export ${project.settings.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
