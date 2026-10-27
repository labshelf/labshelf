// Registers the .bib diagnostics and their quick fixes.
import * as vscode from "vscode";

import {
  createPublishedVersionFinder,
  type ILogger,
  type RegistryEnv,
  parseBibEntries,
  deriveMissingDoiFix,
  type BibliographyProblem,
  checkBibliography,
  type PublishedVersionFinder,
} from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";

const DIAGNOSTIC_SOURCE = "LabShelf";

const SEVERITY = { warning: vscode.DiagnosticSeverity.Warning, information: vscode.DiagnosticSeverity.Information } as const;

interface Linted {
  version: number;
  findings: BibliographyProblem[];
}

const isBibliography = (document: vscode.TextDocument): boolean => document.uri.path.endsWith(".bib");

function toDiagnostic(document: vscode.TextDocument, finding: BibliographyProblem): vscode.Diagnostic {
  const range = new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.end));
  const diagnostic = new vscode.Diagnostic(range, finding.message, SEVERITY[finding.severity]);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = finding.rule;
  return diagnostic;
}

// The linter hits the network for preprints, so it runs on open and save, never while a key or an arXiv id is half typed.
export class BibliographyProblems implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("labshelf-bib");
  private readonly linted = new Map<string, Linted>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly lookup: PublishedVersionFinder, private readonly logger: () => ILogger | undefined) {
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument((document) => void this.lint(document)),
      vscode.workspace.onDidSaveTextDocument((document) => void this.lint(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document)),
    ];
    vscode.workspace.textDocuments.forEach((document) => void this.lint(document));
  }

  dispose(): void {
    disposeAll(this.subscriptions);
    this.collection.dispose();
  }

  /** The finding behind a diagnostic range, only while the document is as it was when linted. */
  findingAt(document: vscode.TextDocument, range: vscode.Range, rule: unknown): BibliographyProblem | undefined {
    const linted = this.linted.get(document.uri.toString());
    if (linted?.version !== document.version) { return undefined; }
    const start = document.offsetAt(range.start);
    const end = document.offsetAt(range.end);
    return linted.findings.find((finding) => finding.rule === rule && finding.start === start && finding.end === end);
  }

  private async lint(document: vscode.TextDocument): Promise<void> {
    if (!isBibliography(document)) { return; }
    const version = document.version;
    try {
      const findings = await checkBibliography(document.getText(), this.lookup);
      // A later save lints the newer text; ranges computed on this one would point at the wrong characters.
      if (document.isClosed || document.version !== version) { return; }
      this.linted.set(document.uri.toString(), { version, findings });
      this.collection.set(document.uri, findings.map((finding) => toDiagnostic(document, finding)));
    } catch (error) {
      await this.logger()?.error("writing/bibliography", error, { file: document.uri.fsPath, action: "lint" });
    }
  }

  private forget(document: vscode.TextDocument): void {
    this.linted.delete(document.uri.toString());
    this.collection.delete(document.uri);
  }
}

interface DoiLookup {
  document: vscode.TextDocument;
  finding: BibliographyProblem;
}

function replaceEdit(document: vscode.TextDocument, start: number, end: number, text: string): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
  return edit;
}

export class BibliographyCodeActions implements vscode.CodeActionProvider {
  private readonly lookups = new WeakMap<vscode.CodeAction, DoiLookup>();

  constructor(
    private readonly diagnostics: BibliographyProblems,
    private readonly env: RegistryEnv,
    private readonly logger: () => ILogger | undefined,
  ) {}

  provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const diagnostic of context.diagnostics) {
      const finding = diagnostic.source === DIAGNOSTIC_SOURCE ? this.diagnostics.findingAt(document, diagnostic.range, diagnostic.code) : undefined;
      if (!finding) { continue; }
      if (finding.fix) {
        const action = new vscode.CodeAction(finding.fix.title, vscode.CodeActionKind.QuickFix);
        action.edit = replaceEdit(document, finding.fix.start, finding.fix.end, finding.fix.text);
        action.isPreferred = finding.rule === "published-version";
        action.diagnostics = [diagnostic];
        actions.push(action);
      } else if (finding.rule === "missing-doi") {
        const action = new vscode.CodeAction("Look up the DOI", vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        this.lookups.set(action, { document, finding });
        actions.push(action);
      }
    }
    return actions;
  }

  async resolveCodeAction(action: vscode.CodeAction): Promise<vscode.CodeAction> {
    const lookup = this.lookups.get(action);
    if (!lookup) { return action; }
    const { document, finding } = lookup;
    const version = document.version;
    try {
      const text = document.getText();
      const entry = parseBibEntries(text).find((candidate) => candidate.start === finding.start);
      if (!entry) { return action; }
      const fix = await deriveMissingDoiFix(this.env, text, entry);
      if (document.version !== version) { return action; }
      if (fix) {
        action.edit = replaceEdit(document, fix.start, fix.end, fix.text);
      } else {
        void vscode.window.showInformationMessage(`No DOI found for ${finding.key}.`);
      }
    } catch (error) {
      await this.logger()?.error("writing/bibliography", error, { file: document.uri.fsPath, action: "look-up-doi" });
    }
    return action;
  }
}

export function registerBibliographyCheck(context: vscode.ExtensionContext, host: { logger: () => ILogger | undefined }): void {
  // The library root, and with it the logger, can change after activation.
  const env: RegistryEnv = { fetch: globalThis.fetch, get logger() { return host.logger(); } };
  const diagnostics = new BibliographyProblems(createPublishedVersionFinder(env), host.logger);
  const actions = new BibliographyCodeActions(diagnostics, env, host.logger);
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeActionsProvider({ pattern: "**/*.bib" }, actions, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
  );
}
