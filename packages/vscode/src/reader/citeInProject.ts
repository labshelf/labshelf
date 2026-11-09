// The VS Code side of the reader's cite popup: the IO answerReaderCite runs over, reading the open TextDocument and writing through a WorkspaceEdit.
import * as vscode from "vscode";

import {
  PROJECT_FILE, answerReaderCite, withListedPaper,
  type CiteReply, type CiteRequest, type PaperRecord, type ReaderCiteIo, type ReadyProject,
} from "@labshelf/core";
import { UPDATE_BIBLIOGRAPHY_COMMAND } from "../writing/citations/completionItems.js";
import type { ActiveSource } from "../writing/activeSource.js";
import type { WritingProjects } from "../writing/projects/index.js";

export interface ReaderCiteDeps {
  projects: Pick<WritingProjects, "list" | "paths" | "fs" | "reload"> & { data: Pick<WritingProjects["data"], "listProjectFiles" | "updateProjectSettings"> };
  activeSource: Pick<ActiveSource, "current" | "listOpen">;
}

/** Answers one request of the reader's cite popup for the paper the reader shows. */
export type ReaderCite = (paper: PaperRecord, request: CiteRequest) => Promise<CiteReply>;

function readyProjects(deps: ReaderCiteDeps): ReadyProject[] {
  return deps.projects.list().filter((entry): entry is ReadyProject => entry.kind === "ready");
}

/** The project's labshelf.yaml as last read, so the paper is added to its current list. */
function latest(deps: ReaderCiteDeps, project: ReadyProject): ReadyProject {
  return readyProjects(deps).find((entry) => entry.folder === project.folder) ?? project;
}

const fileOf = (deps: ReaderCiteDeps, project: ReadyProject, path: string): vscode.Uri =>
  vscode.Uri.file(deps.projects.paths.join(project.folder, ...path.split("/")));

const openDocument = (uri: vscode.Uri): vscode.TextDocument | undefined =>
  vscode.workspace.textDocuments.find((document) => document.uri.fsPath === uri.fsPath);

/** The path of `file` inside the project folder, '/'-separated; undefined outside it. */
function relativeTo(deps: ReaderCiteDeps, project: ReadyProject, file: string): string | undefined {
  const { paths } = deps.projects;
  const relative = paths.relative(project.folder, file);
  const parts = relative.split(paths.sep);
  return relative === "" || parts[0] === ".." || relative.startsWith(paths.sep) || /^[A-Za-z]:/.test(relative) ? undefined : parts.join("/");
}

async function insertAt(uri: vscode.Uri, offset: number, text: string): Promise<void> {
  const wasOpen = openDocument(uri) !== undefined;
  const document = openDocument(uri) ?? await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  const position = document.positionAt(offset);
  edit.replace(uri, new vscode.Range(position, position), text);
  if (!await vscode.workspace.applyEdit(edit)) { throw new Error(`Could not write ${uri.fsPath}.`); }
  // An open editor keeps the edit unsaved for the user to decide; a file the edit opened is saved.
  if (!wasOpen && !await document.save()) { throw new Error(`Could not save ${uri.fsPath}.`); }
}

/** The IO of the cite popup over the writing projects, the open documents and the editors. */
export function createReaderCiteIo(deps: ReaderCiteDeps): ReaderCiteIo {
  return {
    projects: async () => readyProjects(deps),
    listFiles: (project) => deps.projects.data.listProjectFiles(project.folder),
    recentFiles(project) {
      const views = [deps.activeSource.current(), ...deps.activeSource.listOpen()].flatMap((view) => view ? [view.uri] : []);
      const visible = vscode.window.visibleTextEditors.map((editor) => editor.document.uri);
      const files = [...views, ...visible].filter((uri) => uri.scheme === "file").map((uri) => relativeTo(deps, project, uri.fsPath));
      return files.filter((file, index): file is string => file !== undefined && files.indexOf(file) === index);
    },
    async read(project, path) {
      const uri = fileOf(deps, project, path);
      return openDocument(uri)?.getText() ?? deps.projects.fs.readText(uri.fsPath);
    },
    insert: (project, path, offset, text) => insertAt(fileOf(deps, project, path), offset, text),
    async addToBibliography(chosen, paper) {
      const project = latest(deps, chosen);
      const papers = withListedPaper(project.settings.papers ?? [], paper);
      if (!papers) { return; }
      await deps.projects.data.updateProjectSettings(project.folder, { papers });
      await deps.projects.reload();
      await vscode.commands.executeCommand(UPDATE_BIBLIOGRAPHY_COMMAND, vscode.Uri.file(deps.projects.paths.join(project.folder, PROJECT_FILE)));
    },
    async refreshBibliography(project, path) {
      // The bibliography sync reads the editor's unsaved text, so the citation reaches labshelf.bib before the file is saved.
      await vscode.commands.executeCommand(UPDATE_BIBLIOGRAPHY_COMMAND, fileOf(deps, project, path));
    },
  };
}

/** The reader port: answers the cite popup's requests for the reader's paper. */
export function createReaderCite(deps: ReaderCiteDeps): ReaderCite {
  const io = createReaderCiteIo(deps);
  return (paper, request) => answerReaderCite(io, paper, request);
}
