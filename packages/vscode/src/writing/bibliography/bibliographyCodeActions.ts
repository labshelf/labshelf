// Offers the linter's fixes as quick fixes, and looks up a missing DOI only when the user picks that action.
import * as vscode from "vscode";

import { bibEntries, missingDoiFix, type BibFinding, type ILogger, type RegistryEnv } from "@labshelf/core";
import { DIAGNOSTIC_SOURCE, type BibDiagnostics } from "./bibliographyProblems.js";

interface DoiLookup {
  document: vscode.TextDocument;
  finding: BibFinding;
}

function replaceEdit(document: vscode.TextDocument, start: number, end: number, text: string): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(start), document.positionAt(end)), text);
  return edit;
}

export class BibCodeActions implements vscode.CodeActionProvider {
  private readonly lookups = new WeakMap<vscode.CodeAction, DoiLookup>();

  constructor(
    private readonly diagnostics: BibDiagnostics,
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
      const entry = bibEntries(text).find((candidate) => candidate.start === finding.start);
      if (!entry) { return action; }
      const fix = await missingDoiFix(this.env, text, entry);
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
