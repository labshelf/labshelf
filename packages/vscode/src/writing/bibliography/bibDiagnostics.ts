// Publishes the bibliography linter's findings on open and saved .bib documents and remembers them for the quick fixes.
import * as vscode from "vscode";

import { lintBibliography, type BibFinding, type ILogger, type PublishedVersionLookup } from "@labshelf/core";

export const DIAGNOSTIC_SOURCE = "LabShelf";

const SEVERITY = { warning: vscode.DiagnosticSeverity.Warning, information: vscode.DiagnosticSeverity.Information } as const;

interface Linted {
  version: number;
  findings: BibFinding[];
}

const isBibliography = (document: vscode.TextDocument): boolean => document.uri.path.endsWith(".bib");

function toDiagnostic(document: vscode.TextDocument, finding: BibFinding): vscode.Diagnostic {
  const range = new vscode.Range(document.positionAt(finding.start), document.positionAt(finding.end));
  const diagnostic = new vscode.Diagnostic(range, finding.message, SEVERITY[finding.severity]);
  diagnostic.source = DIAGNOSTIC_SOURCE;
  diagnostic.code = finding.rule;
  return diagnostic;
}

// The linter hits the network for preprints, so it runs on open and save, never while a key or an arXiv id is half typed.
export class BibDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("labshelf-bib");
  private readonly linted = new Map<string, Linted>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly lookup: PublishedVersionLookup, private readonly logger: () => ILogger | undefined) {
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument((document) => void this.lint(document)),
      vscode.workspace.onDidSaveTextDocument((document) => void this.lint(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document)),
    ];
    vscode.workspace.textDocuments.forEach((document) => void this.lint(document));
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.collection.dispose();
  }

  /** The finding behind a diagnostic range, only while the document is as it was when linted. */
  findingAt(document: vscode.TextDocument, range: vscode.Range, rule: unknown): BibFinding | undefined {
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
      const findings = await lintBibliography(document.getText(), this.lookup);
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
