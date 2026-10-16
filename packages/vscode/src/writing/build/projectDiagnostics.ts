// Holds a diagnostic collection whose entries belong to projects, so a project's new entries replace only its own old ones.
import * as vscode from "vscode";

export class ProjectDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly filesByProject = new Map<string, vscode.Uri[]>();

  constructor(name: string) {
    this.collection = vscode.languages.createDiagnosticCollection(name);
  }

  /** Clears what the project published before, then shows `byFile` (absolute file path to its diagnostics). */
  replace(projectFolder: string, byFile: ReadonlyMap<string, vscode.Diagnostic[]>): void {
    for (const uri of this.filesByProject.get(projectFolder) ?? []) { this.collection.delete(uri); }
    const uris: vscode.Uri[] = [];
    for (const [file, diagnostics] of byFile) {
      const uri = vscode.Uri.file(file);
      this.collection.set(uri, diagnostics);
      uris.push(uri);
    }
    this.filesByProject.set(projectFolder, uris);
  }

  dispose(): void {
    this.collection.dispose();
  }
}
