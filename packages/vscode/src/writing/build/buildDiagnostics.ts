// Shows each project's build problems in the Problems panel and replaces them on the next build of that project.
import * as vscode from "vscode";

import type { LocatedProblem } from "@labshelf/core/node";

const SEVERITY = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
} as const;

function diagnostic(problem: LocatedProblem): vscode.Diagnostic {
  const line = Math.max(0, (problem.line ?? 1) - 1);
  const message = problem.hint ? `${problem.message}\n${problem.hint}` : problem.message;
  const result = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), message, SEVERITY[problem.severity]);
  result.source = "LabShelf";
  return result;
}

export class BuildDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("labshelf-latex");
  private readonly filesByProject = new Map<string, vscode.Uri[]>();

  publish(projectFolder: string, problems: readonly LocatedProblem[]): void {
    for (const uri of this.filesByProject.get(projectFolder) ?? []) { this.collection.delete(uri); }
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const problem of problems) {
      byFile.set(problem.file, [...byFile.get(problem.file) ?? [], diagnostic(problem)]);
    }
    const uris = [...byFile.keys()].map((file) => vscode.Uri.file(file));
    uris.forEach((uri, index) => this.collection.set(uri, [...byFile.values()][index]));
    this.filesByProject.set(projectFolder, uris);
  }

  dispose(): void {
    this.collection.dispose();
  }
}
