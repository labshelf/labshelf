// Reads the setting that stops a LaTeX build at its first error.
import * as vscode from "vscode";

export function haltOnErrorOn(): boolean {
  return vscode.workspace.getConfiguration("labshelf.writing").get<unknown>("haltOnError", false) === true;
}
