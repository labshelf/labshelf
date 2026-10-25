// Registers LaTeX command and environment completion and the \begin auto-close for LaTeX documents.
import * as vscode from "vscode";

import { LatexCommandCompletionProvider } from "./latexCommandCompletion.js";
import { registerLatexEnvironmentAutoClose } from "./latexEnvironmentClose.js";

export function registerLatexCommandCompletion(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ language: "latex" }, new LatexCommandCompletionProvider(), "\\", "{"),
  );
  registerLatexEnvironmentAutoClose(context);
}
