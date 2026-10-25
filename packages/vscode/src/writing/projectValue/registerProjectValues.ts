// Registers value completion and hover for `\lsvalue` in LaTeX and json() paths in Typst.
import * as vscode from "vscode";

import { ProjectValues, type ValuesWorkspace } from "./projectValues.js";
import { ValueCompletionProvider } from "./projectValueCompletion.js";
import { ValueHoverProvider } from "./projectValueHover.js";

// Typst has no built-in language id, so sources are matched by file name.
const SOURCES = [
  { selector: { scheme: "file", pattern: "**/*.tex" }, triggers: ["{", "."] },
  { selector: { scheme: "file", pattern: "**/*.typ" }, triggers: ["."] },
];

export function registerWritingValues(context: vscode.ExtensionContext, workspace: ValuesWorkspace): void {
  const values = new ProjectValues(workspace);
  const completion = new ValueCompletionProvider(values);
  const hover = new ValueHoverProvider(values);
  context.subscriptions.push(values);
  for (const { selector, triggers } of SOURCES) {
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(selector, completion, ...triggers),
      vscode.languages.registerHoverProvider(selector, hover),
    );
  }
}
