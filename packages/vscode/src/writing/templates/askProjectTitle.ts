// Asks the user for the title of the project a template creates.
import * as vscode from "vscode";

/** @returns the trimmed title, or undefined when the user cancels */
export async function askProjectTitle(defaultTitle: string): Promise<string | undefined> {
  const title = await vscode.window.showInputBox({
    title: "New project from template",
    prompt: "Project title",
    value: defaultTitle,
    validateInput: (value) => (value.trim() ? undefined : "Enter a title"),
  });
  return title?.trim();
}
