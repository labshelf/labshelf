// Offers the label features of LaTeX editing: listing the project's labels, reference completion, go-to-definition and undefined-reference diagnostics.
import * as vscode from "vscode";

import { createKeyedDebouncer, findUndefinedReferences, scanLatexSource, type LatexRange } from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";
import { deriveVscodeRange, type LatexProject, type LatexProjectSources } from "./project.js";

export interface ProjectLabel {
  name: string;
  /** The project-root-relative path of the file defining it. */
  path: string;
  range: LatexRange;
  /** The trimmed source line holding the label. */
  line: string;
}

export function listProjectLabels(project: LatexProject): ProjectLabel[] {
  return project.files.flatMap((file) => {
    const lines = project.texts.get(file.path)?.split("\n") ?? [];
    return file.facts.labels.map((label) => ({
      name: label.name, path: file.path, range: label.range, line: lines[label.range.start.line]?.trim() ?? "",
    }));
  });
}


/**
 * The column where the label name being typed starts, when the cursor sits inside the braces of a ref command.
 * The scanner drops empty names, so a stand-in letter and a closing brace are appended to make it yield one.
 */
function partialRefStart(linePrefix: string): number | undefined {
  const { refs } = scanLatexSource(`${linePrefix}x}`);
  const typing = refs.find((ref) => ref.range.end.line === 0 && ref.range.end.character === linePrefix.length + 1);
  return typing?.range.start.character;
}

export class ReferenceCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly sources: LatexProjectSources) {}

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
  ): Promise<vscode.CompletionItem[] | undefined> {
    const prefix = document.lineAt(position.line).text.slice(0, position.character);
    const start = partialRefStart(prefix);
    if (start === undefined) { return undefined; }
    const project = await this.sources.projectSourcesFor(document);
    if (!project) { return undefined; }
    const range = new vscode.Range(position.line, start, position.line, position.character);
    const seen = new Set<string>();
    const items: vscode.CompletionItem[] = [];
    for (const label of listProjectLabels(project)) {
      if (seen.has(label.name)) { continue; }
      seen.add(label.name);
      const item = new vscode.CompletionItem(label.name, vscode.CompletionItemKind.Reference);
      item.detail = `${label.path}:${label.range.start.line + 1}`;
      item.documentation = label.line;
      item.range = range;
      items.push(item);
    }
    return items;
  }
}

export class ReferenceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly sources: LatexProjectSources) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[] | undefined> {
    const ref = scanLatexSource(document.getText()).refs.find(({ range }) =>
      range.start.line === position.line && range.start.character <= position.character && position.character <= range.end.character);
    if (!ref) { return undefined; }
    const project = await this.sources.projectSourcesFor(document);
    if (!project) { return undefined; }
    const found = listProjectLabels(project).filter((label) => label.name === ref.name).map((label) =>
      new vscode.Location(vscode.Uri.joinPath(project.root, label.path), deriveVscodeRange(label.range)));
    return found.length > 0 ? found : undefined;
  }
}

const REFRESH_DELAY_MS = 300;

function diagnosticsByFile(project: LatexProject): Map<string, vscode.Diagnostic[]> {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  const add = (path: string, diagnostic: vscode.Diagnostic): void => {
    diagnostic.source = "LabShelf";
    byFile.set(path, [...byFile.get(path) ?? [], diagnostic]);
  };
  for (const { path, ref } of findUndefinedReferences(project.files)) {
    add(path, new vscode.Diagnostic(deriveVscodeRange(ref.range), `No \\label{${ref.name}} in this project.`, vscode.DiagnosticSeverity.Warning));
  }
  for (const { path, includedFrom } of project.missing) {
    if (!includedFrom) { continue; }
    add(includedFrom.file, new vscode.Diagnostic(deriveVscodeRange(includedFrom.range), `File not found: ${path}.`, vscode.DiagnosticSeverity.Information));
  }
  return byFile;
}

export class LabelProblems implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("labshelf-labels");
  private readonly published = new Map<string, vscode.Uri[]>();
  private readonly refresh = createKeyedDebouncer<string>(REFRESH_DELAY_MS, (folder) => void this.publish(folder));
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly sources: LatexProjectSources) {
    const scheduleFor = (document: vscode.TextDocument): void => {
      const folder = sources.projectOf(document.uri)?.folder;
      if (folder !== undefined) { this.refresh.call(folder); }
    };
    this.subscriptions = [sources.onDidChange((folder) => this.refresh.call(folder)), vscode.workspace.onDidOpenTextDocument(scheduleFor)];
    vscode.workspace.textDocuments.forEach(scheduleFor);
  }

  dispose(): void {
    this.refresh.dispose();
    disposeAll(this.subscriptions);
    this.collection.dispose();
  }

  private hasOpenDocuments(folder: string): boolean {
    return vscode.workspace.textDocuments.some((document) => !document.isClosed && this.sources.projectOf(document.uri)?.folder === folder);
  }

  private async publish(folder: string): Promise<void> {
    const project = this.hasOpenDocuments(folder) ? await this.sources.projectSourcesAt(folder) : undefined;
    for (const uri of this.published.get(folder) ?? []) { this.collection.delete(uri); }
    this.published.delete(folder);
    if (!project) { return; }
    const uris: vscode.Uri[] = [];
    for (const [path, diagnostics] of diagnosticsByFile(project)) {
      const uri = vscode.Uri.joinPath(project.root, path);
      this.collection.set(uri, diagnostics);
      uris.push(uri);
    }
    this.published.set(folder, uris);
  }
}

const SELECTOR = { scheme: "file", pattern: "**/*.tex" };

export function registerLabelProviders(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, new ReferenceCompletionProvider(sources), "{", ","),
    vscode.languages.registerDefinitionProvider(SELECTOR, new ReferenceDefinitionProvider(sources)),
    new LabelProblems(sources),
  );
}
