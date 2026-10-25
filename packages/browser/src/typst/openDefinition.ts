// Opens the definition of the symbol at a position in its file's tab and reveals its line.
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { TypstLanguageService } from "@labshelf/core/typst/language";
import type { Workspace } from "../libraryUi/editorArea";
import { revealInOpenEditor } from "../writing/session";

export interface DefinitionTarget {
  projectId: string;
  openTab: Workspace["openTab"];
}

async function goToDefinition(
  view: EditorView, service: TypstLanguageService, path: string, pos: number, target: DefinitionTarget,
): Promise<void> {
  const definition = await service.definition(path, view.state.doc.toString(), pos);
  if (!definition) return;
  target.openTab("source", { projectId: target.projectId, path: definition.path }, 0);
  revealInOpenEditor(target.projectId, definition.path, definition.line);
}

/** F12 and Ctrl/Cmd+click go to the definition. */
export function definitionBindings(service: TypstLanguageService, path: string, target: DefinitionTarget): Extension {
  return [
    Prec.high(keymap.of([{ key: "F12", run: (view) => { void goToDefinition(view, service, path, view.state.selection.main.head, target); return true; } }])),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        event.preventDefault();
        void goToDefinition(view, service, path, pos, target);
        return true;
      },
    }),
  ];
}
