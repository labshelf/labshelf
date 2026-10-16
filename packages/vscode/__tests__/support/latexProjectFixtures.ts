// Builds an in-memory LaTeX project: files on a fake disk, open editors and the project sources service over them.
import * as path from "node:path";
import * as vscode from "vscode";

import { LatexProjectSources } from "../../src/writing/latexEditing/index";
import { fakeDocument } from "./textDocument";
import { fakeLogger, fakeProjects, readyEntry } from "./writingFixtures";

export const ROOT = "/code/repo";

const originalReadFile = (vscode.workspace.fs.readFile as jest.Mock).getMockImplementation();

export function restoreDiskReads(): void {
  (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(originalReadFile);
}

/** Project-relative path to the absolute path of the fake project. */
export const at = (relative: string): string => `${ROOT}/${relative}`;

export function latexProject(disk: Record<string, string>, over: { main?: string | undefined } = { main: "main.tex" }) {
  (vscode.workspace.fs.readFile as jest.Mock).mockImplementation(async (uri: vscode.Uri) => {
    const text = disk[uri.fsPath.slice(ROOT.length + 1)];
    if (text === undefined) { throw Object.assign(new Error("not found"), { code: "FileNotFound" }); }
    return new TextEncoder().encode(text);
  });
  const entries = [readyEntry(ROOT, { main: over.main })];
  const projects = Object.assign(fakeProjects(entries), { changes: new vscode.EventEmitter<void>() });
  const logger = fakeLogger();
  const sources = new LatexProjectSources({
    projects: { list: projects.list, paths: path, onDidChange: projects.changes.event }, logger: () => logger,
  });
  const documents: vscode.TextDocument[] = [];
  const open = (relative: string, text = disk[relative] ?? ""): vscode.TextDocument => {
    const document = fakeDocument(at(relative), text);
    documents.push(document);
    (vscode.workspace as unknown as { textDocuments: vscode.TextDocument[] }).textDocuments = documents;
    return document;
  };
  const edit = (document: vscode.TextDocument): void => {
    (vscode.workspace as unknown as { _fireTextDocumentChange: (e: unknown) => void })._fireTextDocumentChange({ document });
  };
  return { sources, projects, logger, open, edit, disk };
}

export function resetOpenDocuments(): void {
  (vscode.workspace as unknown as { textDocuments: vscode.TextDocument[] }).textDocuments = [];
}
