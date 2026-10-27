// Exports a project (PDF, zip, arXiv bundle, converted document) and installs the papers its labshelf.yaml lists.
import { zipSync } from "fflate";
import * as vscode from "vscode";

import {
  DEFAULT_BIBLIOGRAPHY, DOCUMENT_EXPORT_EXTENSIONS, createArxivBundle, createInstallPlan, deriveProjectFiles, describeInstall, describeInstallReport,
  formatError, isInstallResolved, listBibliographyFiles, scanCiteKeys,
  type DocumentExport, type ILogger, type InstallResult, type PaperRecord, type PathOps, type ProjectEntry, type ProjectFormat,
} from "@labshelf/core";
import { addTextLayersOfAdded, runSafely } from "../../command/index.js";
import type { PaperImporter, PaperTextLayers } from "../../library/index.js";
import { readActiveProject } from "../build/index.js";
import { readBuiltPdf } from "../preview/index.js";
import type { WritingHost, WritingProjects } from "../projects/index.js";
import type { ReadyProject } from "./projects.js";

// ---- Zip contents

/** Zip entries by project-relative POSIX path. */
export type ZipEntries = Record<string, Uint8Array>;

const SOURCE_EXTENSION = { latex: ".tex", typst: ".typ" } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readBytes(project: ReadyProject, relative: string): Promise<Uint8Array> {
  return await vscode.workspace.fs.readFile(vscode.Uri.joinPath(vscode.Uri.file(project.folder), relative));
}

async function readText(project: ReadyProject, relative: string): Promise<string> {
  return decoder.decode(await readBytes(project, relative));
}

/** The files to export: every file of the folder except build output, tool state and the generated bibliography. */
async function exportableFiles(paths: PathOps, project: ReadyProject): Promise<{ sources: string[]; generated: string }> {
  const found = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.file(project.folder), "**/*"));
  const list = found.map((uri) => paths.relative(project.folder, uri.fsPath).split(paths.sep).join("/")).sort();
  // TRAP: core drops only the literal labshelf.bib; a custom `bibliography:` path is removed here.
  const generated = project.settings.bibliography ?? DEFAULT_BIBLIOGRAPHY;
  return { sources: deriveProjectFiles(list).filter((path) => path !== generated), generated };
}

async function readAll(project: ReadyProject, relatives: string[]): Promise<ZipEntries> {
  const bytes = await Promise.all(relatives.map((relative) => readBytes(project, relative)));
  return Object.fromEntries(relatives.map((relative, index) => [relative, bytes[index]!]));
}

export async function listProjectZipEntries(paths: PathOps, project: ReadyProject): Promise<ZipEntries> {
  return await readAll(project, (await exportableFiles(paths, project)).sources);
}

/** The project's files with each .bib cut to the entries the sources cite. */
export async function listArxivZipEntries(paths: PathOps, project: ReadyProject, root: string): Promise<ZipEntries> {
  const { sources, generated } = await exportableFiles(paths, project);
  const bibPaths = listBibliographyFiles(await readText(project, root), generated).filter((path) => sources.includes(path));
  const bibs = await Promise.all(bibPaths.map(async (path) => ({ path, text: await readText(project, path) })));
  const { format } = project.settings;
  const texts = await Promise.all(sources.filter((path) => path.endsWith(SOURCE_EXTENSION[format])).map((path) => readText(project, path)));
  const cited = [...new Set(texts.flatMap((text) => scanCiteKeys(format, text)))];
  const bundle = createArxivBundle(sources, bibs, cited);
  const entries = await readAll(project, bundle.files);
  for (const bib of bundle.bibs) { entries[bib.path] = encoder.encode(bib.text); }
  return entries;
}

// ---- Export

const MODULE = "writing.export";

export type ExportKind = "pdf" | "systemViewer" | "projectZip" | "arxivZip" | DocumentExport;

/** Converts a project root to a document; pandoc on the desktop. */
export type ConvertProject = (request: { format: ProjectFormat; folder: string; main: string; target: DocumentExport; output: string }) => Promise<void>;

export interface ExportProjectDeps {
  logger: ILogger;
  projects: Pick<WritingProjects, "data" | "paths" | "fs">;
  /** Absent where documents cannot be converted, which leaves the document targets unregistered. */
  convertDocument?: ConvertProject;
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

async function run(deps: ExportProjectDeps, project: ReadyProject, root: string, target: ExportKind): Promise<void> {
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
export async function exportProject(deps: ExportProjectDeps, project: ReadyProject, root: string, target: ExportKind): Promise<void> {
  try {
    await run(deps, project, root, target);
  } catch (error) {
    await deps.logger.error(MODULE, error, { project: project.settings.id, root, target });
    void vscode.window.showErrorMessage(`Could not export ${project.settings.id}: ${formatError(error)}`);
  }
}

// ---- Export commands

interface ExportCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
  convertDocument?: ConvertProject;
}

const EXPORT_COMMANDS: Record<string, ExportKind> = {
  "labshelf.writing.downloadPdf": "pdf",
  "labshelf.writing.openPdfExternally": "systemViewer",
  "labshelf.writing.downloadSource": "projectZip",
  "labshelf.writing.downloadArxiv": "arxivZip",
};

const DOCUMENT_COMMANDS: Record<string, ExportKind> = {
  "labshelf.writing.exportWord": "docx",
  "labshelf.writing.exportMarkdown": "markdown",
  "labshelf.writing.exportHtml": "html",
};

async function exportEntry({ host, projects, convertDocument }: ExportCommandsDeps, entry: ProjectEntry | undefined, target: ExportKind): Promise<void> {
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

// ---- Install project papers

const INSTALL_COMMAND = "labshelf.installProjectPapers";

/** What the command needs of the open library. */
export interface InstallServices {
  importer: Pick<PaperImporter, "importFromNetwork">;
  textLayers: PaperTextLayers;
  paperService: { listPapers(): Promise<PaperRecord[]> };
  logger: ILogger;
}

interface InstallCommandDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths">;
  services: () => InstallServices | null | undefined;
}

// One at a time: each import's duplicate check must see the papers the earlier ones added.
async function importMissing(services: InstallServices, project: Extract<ProjectEntry, { kind: "ready" }>): Promise<InstallResult[]> {
  const plan = createInstallPlan(project.settings.papers ?? [], await services.paperService.listPapers());
  const total = plan.filter((entry) => entry.kind === "import").length;
  const options = { location: vscode.ProgressLocation.Notification, title: `Installing the papers of "${project.settings.id}"` };
  return vscode.window.withProgress(options, async (progress) => {
    const results: InstallResult[] = [];
    let index = 0;
    for (const entry of plan) {
      if (entry.kind === "import") {
        progress.report({ message: `${++index} of ${total}: ${entry.key}`, ...(index > 1 ? { increment: 100 / total } : {}) });
      }
      const outcome = entry.kind === "import" ? await services.importer.importFromNetwork(entry.doi, undefined, { citeKey: entry.key }) : undefined;
      results.push({ entry, outcome });
    }
    return results;
  });
}

async function installPapers(deps: InstallCommandDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = await deps.host.require();
  const services = deps.services();
  if (!session || !services) { return; }
  await runSafely(session.logger, INSTALL_COMMAND, async () => {
    const project = entry?.kind === "ready" ? entry : readActiveProject(deps.projects);
    if (!project) {
      await vscode.window.showInformationMessage("Open a file of a writing project to install its papers.");
      return;
    }
    const results = await importMissing(services, project);
    addTextLayersOfAdded(services, results.flatMap(({ outcome }) => (outcome ? [outcome] : [])));
    const summary = describeInstallReport(results);
    const unresolved = results.find((result) => !isInstallResolved(result));
    const problem = unresolved && describeInstall(unresolved);
    await session.logger.log("INFO", INSTALL_COMMAND, "Project papers installed", { project: project.settings.id, summary: summary.text });
    const show = summary.level === "warn" ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    void show(`LabShelf: ${summary.text}${problem ? `. ${problem.text}` : ""}`);
  });
}

export function registerInstallCommand(deps: InstallCommandDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(INSTALL_COMMAND, (entry?: ProjectEntry) => installPapers(deps, entry)),
  );
}
