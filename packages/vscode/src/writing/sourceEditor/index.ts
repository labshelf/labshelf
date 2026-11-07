// Registers the LabShelf editor for .tex and .typ files and the two commands that reopen a file in it or in the text editor.
import * as vscode from "vscode";

import { NodeDictionaryStore } from "./node/dictionaryStore.js";

import type { ActiveSource } from "../activeSource.js";
import { registerCustomEditorWithReopen } from "../customEditorTabs.js";
import { useActiveSourceForOpens } from "../openSourceAt.js";
import { SOURCE_EDITOR_VIEW_TYPE, createSourceEditorProvider, type SourceEditorProviderDeps } from "./provider.js";

export type { SourceEditorProviderDeps } from "./provider.js";
export { deckWorkspaceBuilds, provideDeckWorkspace } from "./deckWorkspaceHost.js";
export { provideSourcePresence, type PeerSelection, type SourcePresencePort } from "./presenceBridge.js";

/** `deps.activeSource` is the extension's one ActiveSource, so every LabShelf editor panel registers with the same registry, and every jump to a line (openSourceAt) reveals in its views. */
export function registerSourceEditor(
  context: vscode.ExtensionContext, deps: SourceEditorProviderDeps & { activeSource: Pick<ActiveSource, "register" | "openFor"> },
): void {
  useActiveSourceForOpens(deps.activeSource);
  // Bundled dictionaries ship in the extension; downloaded ones and the user's words stay on this machine.
  const dictionaries = new NodeDictionaryStore({
    bundledDir: vscode.Uri.joinPath(context.extensionUri, "dist", "dictionaries").fsPath,
    storageDir: vscode.Uri.joinPath(context.globalStorageUri, "dictionaries").fsPath,
    fetchFn: (url) => fetch(url), logger: deps.logger,
  });
  context.subscriptions.push(
    { dispose: () => useActiveSourceForOpens(undefined) },
    ...registerCustomEditorWithReopen(SOURCE_EDITOR_VIEW_TYPE, createSourceEditorProvider({ dictionaries, ...deps }), "labshelf.sourceEditor"),
  );
}
