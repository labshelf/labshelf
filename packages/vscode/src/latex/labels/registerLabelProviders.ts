// Registers label completion, go-to-definition and undefined-reference diagnostics for LaTeX sources.
import * as vscode from "vscode";

import { type LatexProjectSources, toVscodeRange, type LatexProject } from "../project/index.js";
import { RefCompletionProvider } from "./referenceCompletion.js";
import { RefDefinitionProvider } from "./referenceDefinition.js";
import { findUndefinedReferences } from "@labshelf/core";
import { trailingDebounce } from "../debounce.js";

const REFRESH_DELAY_MS = 300;

function diagnosticsByFile(project: LatexProject): Map<string, vscode.Diagnostic[]> {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  const add = (path: string, diagnostic: vscode.Diagnostic): void => {
    diagnostic.source = "LabShelf";
    byFile.set(path, [...byFile.get(path) ?? [], diagnostic]);
  };
  for (const { path, ref } of findUndefinedReferences(project.files)) {
    add(path, new vscode.Diagnostic(toVscodeRange(ref.range), `No \\label{${ref.name}} in this project.`, vscode.DiagnosticSeverity.Warning));
  }
  for (const { path, includedFrom } of project.missing) {
    if (!includedFrom) { continue; }
    add(includedFrom.file, new vscode.Diagnostic(toVscodeRange(includedFrom.range), `File not found: ${path}.`, vscode.DiagnosticSeverity.Information));
  }
  return byFile;
}

export class LabelDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("labshelf-labels");
  private readonly published = new Map<string, vscode.Uri[]>();
  private readonly refresh = trailingDebounce<string>(REFRESH_DELAY_MS, (folder) => void this.publish(folder));
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
    this.subscriptions.forEach((subscription) => subscription.dispose());
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
    vscode.languages.registerCompletionItemProvider(SELECTOR, new RefCompletionProvider(sources), "{", ","),
    vscode.languages.registerDefinitionProvider(SELECTOR, new RefDefinitionProvider(sources)),
    new LabelDiagnostics(sources),
  );
}
