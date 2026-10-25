// Registers the open project menu's download and export commands on a project entry.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import type { WritingHost, WritingProjects } from "./session/index.js";
import { exportProject, type ConvertDocument, type ExportTarget } from "./exportProject.js";

interface ExportCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
  convertDocument?: ConvertDocument;
}

const EXPORT_COMMANDS: Record<string, ExportTarget> = {
  "labshelf.writing.downloadPdf": "pdf",
  "labshelf.writing.openPdfExternally": "systemViewer",
  "labshelf.writing.downloadSource": "projectZip",
  "labshelf.writing.downloadArxiv": "arxivZip",
};

const DOCUMENT_COMMANDS: Record<string, ExportTarget> = {
  "labshelf.writing.exportWord": "docx",
  "labshelf.writing.exportMarkdown": "markdown",
  "labshelf.writing.exportHtml": "html",
};

async function exportEntry({ host, projects, convertDocument }: ExportCommandsDeps, entry: ProjectEntry | undefined, target: ExportTarget): Promise<void> {
  const session = host.current();
  if (!session || entry?.kind !== "ready") { return; }
  if (!entry.main) {
    await session.logger.log("WARN", "writing.export", "Export asked for a project without a main document", { project: entry.settings.id, target });
    void vscode.window.showWarningMessage(`Set the main document of ${entry.settings.id} to export it.`);
    return;
  }
  await exportProject({ logger: session.logger, projects, ...(convertDocument && { convertDocument }) }, entry, entry.main, target);
}

/** Registers the document exports only where documents can be converted; the manifest hides them elsewhere. */
export function registerExportCommands(deps: ExportCommandsDeps): void {
  const commands = deps.convertDocument ? { ...EXPORT_COMMANDS, ...DOCUMENT_COMMANDS } : EXPORT_COMMANDS;
  deps.context.subscriptions.push(...Object.entries(commands).map(([command, target]) =>
    vscode.commands.registerCommand(command, (entry?: ProjectEntry) => exportEntry(deps, entry, target))));
}
