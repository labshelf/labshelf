// Detects whether the Tinymist extension is installed, which Typst editing support builds on.
import * as vscode from "vscode";

export const TINYMIST_ID = "myriad-dreamin.tinymist";

export function tinymistInstalled(): boolean {
  return vscode.extensions.getExtension(TINYMIST_ID) !== undefined;
}
