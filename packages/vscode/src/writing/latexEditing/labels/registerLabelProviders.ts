// Registers label completion, go-to-definition and undefined-reference diagnostics for LaTeX sources.
import * as vscode from "vscode";

import type { LatexProjectSources } from "../project/index.js";
import { LabelDiagnostics } from "./labelDiagnostics.js";
import { RefCompletionProvider } from "./refCompletion.js";
import { RefDefinitionProvider } from "./refDefinition.js";

const SELECTOR = { scheme: "file", pattern: "**/*.tex" };

export function registerLabelProviders(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, new RefCompletionProvider(sources), "{", ","),
    vscode.languages.registerDefinitionProvider(SELECTOR, new RefDefinitionProvider(sources)),
    new LabelDiagnostics(sources),
  );
}
