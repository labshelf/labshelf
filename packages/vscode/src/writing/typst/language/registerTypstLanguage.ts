// Registers Typst completion, hover and go-to-definition from LabShelf's Typst language service.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";

import type { WritingHost, WritingProjects } from "../../session/index.js";
import {
  type TypstCompletionKind,
  createTypstLanguageService,
  type TypstLanguageService,
  type TypstSources,
} from "@labshelf/core/typst/language";
import { owningProject } from "../../buildRootDocument.js";

const SKIPPED_FOLDERS = new Set(["node_modules"]);

const isSkipped = (name: string): boolean => name.startsWith(".") || SKIPPED_FOLDERS.has(name);

async function walk(folder: vscode.Uri, prefix: string, found: string[]): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(folder);
  for (const [name, type] of entries) {
    if (isSkipped(name)) { continue; }
    if (type & vscode.FileType.Directory) {
      await walk(vscode.Uri.joinPath(folder, name), `${prefix}${name}/`, found);
    } else if (type & vscode.FileType.File) {
      found.push(`${prefix}${name}`);
    }
  }
}

/** The files under `root`, with project-relative `/` paths; `read` returns unsaved editor text before the file on disk. */
export function createTypstSources(root: vscode.Uri | undefined): TypstSources {
  return {
    async list() {
      const found: string[] = [];
      if (root) { await walk(root, "", found); }
      return found;
    },
    async read(path) {
      if (!root) { throw new Error(`No project folder to read ${path} from`); }
      const uri = vscode.Uri.joinPath(root, ...path.split("/"));
      const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
      if (open) { return open.getText(); }
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    },
  };
}

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

export function createTypstHoverProvider(contextOf: TypstContextOf): vscode.HoverProvider {
  return {
    async provideHover(document, position) {
      const { service, path } = contextOf(document);
      const result = await service.hover(path, document.getText(), document.offsetAt(position));
      if (!result) { return undefined; }
      const range = new vscode.Range(document.positionAt(result.from), document.positionAt(result.to));
      return new vscode.Hover(new vscode.MarkdownString(result.text), range);
    },
  };
}

export function createTypstDefinitionProvider(contextOf: TypstContextOf): vscode.DefinitionProvider {
  return {
    async provideDefinition(document, position) {
      const { service, path, root } = contextOf(document);
      const text = document.getText();
      const result = await service.definition(path, text, document.offsetAt(position));
      if (!result || !root) { return undefined; }
      const uri = vscode.Uri.joinPath(root, ...result.path.split("/"));
      // The definition's file may not be open; its offsets map to positions only through its text.
      const target = result.path === path ? document : await vscode.workspace.openTextDocument(uri);
      return new vscode.Location(uri, new vscode.Range(target.positionAt(result.from), target.positionAt(result.to)));
    },
  };
}

const ITEM_KINDS: Record<TypstCompletionKind, vscode.CompletionItemKind> = {
  function: vscode.CompletionItemKind.Function,
  variable: vscode.CompletionItemKind.Variable,
  keyword: vscode.CompletionItemKind.Keyword,
  label: vscode.CompletionItemKind.Reference,
  citation: vscode.CompletionItemKind.Reference,
  file: vscode.CompletionItemKind.File,
  parameter: vscode.CompletionItemKind.Field,
  module: vscode.CompletionItemKind.Module,
  type: vscode.CompletionItemKind.Class,
  value: vscode.CompletionItemKind.Value,
};

export function createTypstCompletionProvider(contextOf: TypstContextOf): vscode.CompletionItemProvider {
  return {
    async provideCompletionItems(document, position, _token, context) {
      const { service, path } = contextOf(document);
      const explicit = context.triggerKind === vscode.CompletionTriggerKind.Invoke;
      const result = await service.complete(path, document.getText(), document.offsetAt(position), explicit);
      if (!result) { return undefined; }
      const range = new vscode.Range(document.positionAt(result.from), document.positionAt(result.to));
      return result.options.map((option, index) => {
        const item = new vscode.CompletionItem(option.label, ITEM_KINDS[option.kind]);
        item.range = range;
        item.insertText = option.snippet ? new vscode.SnippetString(option.insert) : option.insert;
        if (option.detail) { item.detail = option.detail; }
        if (option.doc) { item.documentation = new vscode.MarkdownString(option.doc); }
        // Keeps the service's ranking; VS Code would otherwise sort by label.
        item.sortText = String(index).padStart(5, "0");
        return item;
      });
    },
  };
}

export interface TypstLanguageRegistration {
  context: vscode.ExtensionContext;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "paths">;
}

const TRIGGER_CHARACTERS = ["#", "@", ".", "<", "(", "\"", "/"];

// The session's logger exists only while a library is open, and a provider can run before that.
function hostLogger(host: Pick<WritingHost, "current">): ILogger {
  return {
    log: async (...args) => { await host.current()?.logger.log(...args); },
    error: async (...args) => { await host.current()?.logger.error(...args); },
  };
}

export function registerTypstLanguage(deps: TypstLanguageRegistration): void {
  const contextOf = createTypstContexts(deps.projects, hostLogger(deps.host));
  const selector: vscode.DocumentSelector = [
    { language: "typst", scheme: "file" },
    { language: "typst", scheme: "untitled" },
  ];
  deps.context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(selector, createTypstCompletionProvider(contextOf), ...TRIGGER_CHARACTERS),
    vscode.languages.registerHoverProvider(selector, createTypstHoverProvider(contextOf)),
    vscode.languages.registerDefinitionProvider(selector, createTypstDefinitionProvider(contextOf)),
  );
}
