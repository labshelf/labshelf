// Registers the LabShelf editor for .tex and .typ files and the two commands that reopen a file in it or in the text editor.
import * as vscode from "vscode";

import type { ActiveSource } from "../activeSource.js";
import { useActiveSourceForOpens } from "../openSourceAt.js";
import { SOURCE_EDITOR_VIEW_TYPE, createSourceEditorProvider, type SourceEditorProviderDeps } from "./provider.js";

export type { SourceEditorProviderDeps } from "./provider.js";
export { provideSourcePresence, type PeerSelection, type SourcePresencePort } from "./presenceBridge.js";

const REOPEN_IN_SOURCE_EDITOR_COMMAND = "labshelf.sourceEditor.reopen";
const REOPEN_AS_TEXT_COMMAND = "labshelf.sourceEditor.reopenAsText";

/** The file of the active tab, a text or custom editor alike, and the editor it is open in ("default" for the text editor). */
function activeTabFile(): { uri: vscode.Uri; tab: vscode.Tab; viewType: string } | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (!tab || !input || typeof input !== "object" || !("uri" in input) || !(input.uri instanceof vscode.Uri)) { return undefined; }
  const viewType = "viewType" in input && typeof input.viewType === "string" ? input.viewType : "default";
  return { uri: input.uri, tab, viewType };
}

/** Opens the file with `viewType` and closes the tab it was reopened from, as VS Code's own Reopen Editor With does. */
async function reopenWith(viewType: string, uri: vscode.Uri | undefined): Promise<void> {
  const active = activeTabFile();
  const target = uri ?? active?.uri;
  if (!target) { return; }
  await vscode.commands.executeCommand("vscode.openWith", target, viewType);
  const reopened = active && active.uri.toString() === target.toString() && active.viewType !== viewType;
  if (reopened) { await vscode.window.tabGroups.close(active.tab, true); }
}

/** `deps.activeSource` is the extension's one ActiveSource, so every LabShelf editor panel registers with the same registry, and every jump to a line (openSourceAt) reveals in its views. */
export function registerSourceEditor(
  context: vscode.ExtensionContext, deps: SourceEditorProviderDeps & { activeSource: Pick<ActiveSource, "register" | "openFor"> },
): void {
  useActiveSourceForOpens(deps.activeSource);
  context.subscriptions.push(
    { dispose: () => useActiveSourceForOpens(undefined) },
    vscode.window.registerCustomEditorProvider(SOURCE_EDITOR_VIEW_TYPE, createSourceEditorProvider(deps), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand(REOPEN_IN_SOURCE_EDITOR_COMMAND, (uri?: vscode.Uri) => reopenWith(SOURCE_EDITOR_VIEW_TYPE, uri)),
    vscode.commands.registerCommand(REOPEN_AS_TEXT_COMMAND, (uri?: vscode.Uri) => reopenWith("default", uri)),
  );
}
