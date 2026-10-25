// Holds a diagnostic collection whose entries belong to owners (a project or a build root), so an owner's new entries replace only its own.
import * as vscode from "vscode";

export class ProjectDiagnostics implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;
  private readonly filesByOwner = new Map<string, vscode.Uri[]>();

  constructor(name: string) {
    this.collection = vscode.languages.createDiagnosticCollection(name);
  }

  /** Clears what `owner` published before, then shows `byFile` (absolute file path to its diagnostics). */
  replace(owner: string, byFile: ReadonlyMap<string, vscode.Diagnostic[]>): void {
    for (const uri of this.filesByOwner.get(owner) ?? []) { this.collection.delete(uri); }
    const uris: vscode.Uri[] = [];
    for (const [file, diagnostics] of byFile) {
      const uri = vscode.Uri.file(file);
      this.collection.set(uri, diagnostics);
      uris.push(uri);
    }
    this.filesByOwner.set(owner, uris);
  }

  dispose(): void {
    this.collection.dispose();
  }
}
