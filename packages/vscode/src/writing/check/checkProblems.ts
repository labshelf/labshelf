// Turns pre-submission findings into Problems entries on the source line or the built PDF they concern.
import * as vscode from "vscode";

import type { CheckProblem } from "@labshelf/core";

const SEVERITY = { error: vscode.DiagnosticSeverity.Error, warning: vscode.DiagnosticSeverity.Warning } as const;

function diagnostic(finding: CheckProblem, line: number): vscode.Diagnostic {
  const prefix = finding.location.kind === "pdf" && finding.location.page !== undefined ? `Page ${finding.location.page}: ` : "";
  const result = new vscode.Diagnostic(new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER), `${prefix}${finding.message}`, SEVERITY[finding.severity]);
  result.source = "LabShelf check";
  return result;
}

/** Groups the findings by file; a PDF finding without a source line belongs to the PDF, on its first line. */
export function checkDiagnostics(findings: readonly CheckProblem[], pdfPath: string): Map<string, vscode.Diagnostic[]> {
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const finding of findings) {
    const { location } = finding;
    const file = location.kind === "source" ? location.file : pdfPath;
    const line = location.kind === "source" ? Math.max(0, location.line - 1) : 0;
    byFile.set(file, [...byFile.get(file) ?? [], diagnostic(finding, line)]);
  }
  return byFile;
}
