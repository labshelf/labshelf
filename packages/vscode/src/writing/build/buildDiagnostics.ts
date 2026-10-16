// Shows each project's build problems in the Problems panel and replaces them on the next build of that project.
import * as vscode from "vscode";

import type { LocatedProblem } from "@labshelf/core/node";
import { ProjectDiagnostics } from "./projectDiagnostics.js";

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
  private readonly diagnostics = new ProjectDiagnostics("labshelf-latex");

  publish(projectFolder: string, problems: readonly LocatedProblem[]): void {
    const byFile = new Map<string, vscode.Diagnostic[]>();
    for (const problem of problems) {
      byFile.set(problem.file, [...byFile.get(problem.file) ?? [], diagnostic(problem)]);
    }
    this.diagnostics.replace(projectFolder, byFile);
  }

  dispose(): void {
    this.diagnostics.dispose();
  }
}
