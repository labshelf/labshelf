/** Validates folder names typed in an input box, in the shape vscode.InputBoxOptions.validateInput expects. */
import { checkFolderName } from "@labshelf/core";

export function checkFolderNameInput(value: string): string | null {
  return checkFolderName(value) ?? null;
}
