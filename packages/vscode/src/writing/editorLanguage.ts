// Tells which writing language the active editor holds, so one command serves LaTeX and Typst files.
import type * as vscode from "vscode";

export type WritingLanguage = "latex" | "typst";

export function readWritingLanguage(editor: vscode.TextEditor | undefined): WritingLanguage | undefined {
  const language = editor?.document.languageId;
  return language === "latex" || language === "typst" ? language : undefined;
}
