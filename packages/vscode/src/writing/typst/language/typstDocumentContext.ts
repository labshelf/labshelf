// Finds the project folder and project-relative path of a Typst document and the language service over that folder.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { createTypstLanguageService, type TypstLanguageService } from "@labshelf/core/typst/language";

import { owningProject } from "../../buildRootDocument.js";
import type { WritingProjects } from "../../session/index.js";
import { createTypstSources } from "./typstSources.js";

interface TypstDocumentContext {
  service: TypstLanguageService;
  /** Project-relative, `/`-separated path of the document. */
  path: string;
  root: vscode.Uri | undefined;
}

export type TypstContextOf = (document: vscode.TextDocument) => TypstDocumentContext;

/** The folder whose files a document can reference: its LabShelf project, else its workspace folder, else its own folder. */
function rootOf(projects: Pick<WritingProjects, "list" | "paths">, document: vscode.TextDocument): vscode.Uri | undefined {
  if (document.uri.scheme !== "file") { return undefined; }
  const project = owningProject(projects, document.uri.fsPath);
  if (project) { return vscode.Uri.file(project.folder); }
  return vscode.workspace.getWorkspaceFolder(document.uri)?.uri ?? vscode.Uri.file(projects.paths.dirname(document.uri.fsPath));
}

export function createTypstContexts(projects: Pick<WritingProjects, "list" | "paths">, logger: ILogger): TypstContextOf {
  const services = new Map<string, TypstLanguageService>();
  return (document) => {
    const root = rootOf(projects, document);
    const key = root?.toString() ?? "";
    let service = services.get(key);
    if (!service) {
      service = createTypstLanguageService({ sources: createTypstSources(root), logger });
      services.set(key, service);
    }
    const path = root
      ? projects.paths.relative(root.fsPath, document.uri.fsPath).split(projects.paths.sep).join("/")
      : "untitled.typ";
    return { service, path, root };
  };
}
