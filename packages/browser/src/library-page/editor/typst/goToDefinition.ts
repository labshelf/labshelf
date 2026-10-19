// Opens the definition of the symbol at a position in its file's tab and reveals its line.
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { Workspace } from "../../workspace";
import { revealInOpenEditor } from "../../openEditors";
import { pathOfPageUri, toLspPosition, type LspRange, type TypstDocument } from "./lsp";

export interface DefinitionTarget {
  projectId: string;
  openTab: Workspace["openTab"];
}

interface Location { uri?: string; range?: LspRange; targetUri?: string; targetSelectionRange?: LspRange; targetRange?: LspRange }

/** Resolves true when a definition inside the project was opened. */
export async function goToDefinition(view: EditorView, doc: TypstDocument, pos: number, target: DefinitionTarget): Promise<boolean> {
  const result = await doc.ask<Location | Location[]>("textDocument/definition", toLspPosition(view.state.doc, pos));
  const location = Array.isArray(result) ? result[0] : result;
  const uri = location?.targetUri ?? location?.uri;
  const range = location?.targetSelectionRange ?? location?.targetRange ?? location?.range;
  const path = uri === undefined ? undefined : pathOfPageUri(uri);
  if (path === undefined || !range) return false;
  target.openTab("source", { projectId: target.projectId, path }, 0);
  revealInOpenEditor(target.projectId, path, range.start.line);
  return true;
}

/** F12 and Ctrl/Cmd+click go to the definition. */
export function definitionBindings(doc: TypstDocument, target: DefinitionTarget): Extension {
  return [
    Prec.high(keymap.of([{ key: "F12", run: (view) => { void goToDefinition(view, doc, view.state.selection.main.head, target); return true; } }])),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        event.preventDefault();
        void goToDefinition(view, doc, pos, target);
        return true;
      },
    }),
  ];
}
