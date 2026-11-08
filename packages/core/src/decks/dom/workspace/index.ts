/** Exports the talk and poster workspace (mountDeckWorkspace), its ports and the editor feed a host passes to the source editor so the workspace hears text and cursor changes. */
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { DeckWorkspacePorts } from "./types.js";

export { mountDeckWorkspace } from "./workspace.js";
export { createInsertBar, type InsertItem } from "../shell/index.js";
export { actionButton } from "./propertiesPanel.js";
export type { DeckBuildState, DeckSourceLinks, DeckWorkspace, DeckWorkspaceMode, DeckWorkspacePorts } from "./types.js";

/** A CodeMirror extension that reports text and cursor changes, and the `subscribe` port the workspace listens through. */
export function createDeckWorkspaceFeed(): { extension: Extension; subscribe: DeckWorkspacePorts["subscribe"] } {
  const listeners = new Set<Parameters<DeckWorkspacePorts["subscribe"]>[0]>();
  return {
    extension: EditorView.updateListener.of((update) => {
      for (const listener of listeners) {
        if (update.docChanged) listener.text();
        if (update.selectionSet) listener.cursor(update.state.selection.main.head);
      }
    }),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
