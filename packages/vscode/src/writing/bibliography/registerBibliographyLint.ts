// Registers the .bib diagnostics and their quick fixes.
import * as vscode from "vscode";

import { publishedVersionLookup, type ILogger, type RegistryEnv } from "@labshelf/core";
import { BibCodeActions } from "./bibCodeActions.js";
import { BibDiagnostics } from "./bibDiagnostics.js";

export function registerBibliographyLint(context: vscode.ExtensionContext, host: { logger: () => ILogger | undefined }): void {
  // The library root, and with it the logger, can change after activation.
  const env: RegistryEnv = { fetch: globalThis.fetch, get logger() { return host.logger(); } };
  const diagnostics = new BibDiagnostics(publishedVersionLookup(env), host.logger);
  const actions = new BibCodeActions(diagnostics, env, host.logger);
  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerCodeActionsProvider({ pattern: "**/*.bib" }, actions, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
  );
}
