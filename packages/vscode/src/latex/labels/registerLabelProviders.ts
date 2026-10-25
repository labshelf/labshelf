// Registers label completion, go-to-definition and undefined-reference diagnostics for LaTeX sources.
import * as vscode from "vscode";

import type { LatexProjectSources } from "../project/index.js";
import { LabelDiagnostics } from "./labelProblems.js";
import { RefCompletionProvider } from "./referenceCompletion.js";
import { RefDefinitionProvider } from "./referenceDefinition.js";

const SELECTOR = { scheme: "file", pattern: "**/*.tex" };

export function registerLabelProviders(context: vscode.ExtensionContext, sources: LatexProjectSources): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, new RefCompletionProvider(sources), "{", ","),
    vscode.languages.registerDefinitionProvider(SELECTOR, new RefDefinitionProvider(sources)),
    new LabelDiagnostics(sources),
  );
}
