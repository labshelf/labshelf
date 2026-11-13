// The body of a consult window over an EditableFile (plan local-sync D8): a CodeMirror view for a text file (bound by collab or by a host
// SourceDocument) or the note editor for a qmd file, edited in place; destroy flushes, then releases the file exactly once.
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { createCollabExtensions } from "../../../collab/dom/editorCollab.js";
import { mountNoteFile } from "../../../qmd/dom/mountNoteFile.js";
import { createCodeView } from "../../dom/sourceEditor/codeView.js";
import { createDocumentExtensions, documentSync } from "../../dom/sourceEditor/documentMode.js";
import type { EditableFile } from "./editableFile.js";

export interface EditableView { flush(): Promise<void>; destroy(): Promise<void> }

type Mounted = { flush(): Promise<void>; teardown(): void };

/** A client id per view, so two views of one document are two collab clients. */
function newClientId(): string {
  return `consult-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function mountText(body: HTMLElement, file: Extract<EditableFile, { kind: "text" }>): Mounted {
  const { binding, path } = file;
  if ("collab" in binding) {
    const view = createCodeView(body, {
      path, text: binding.collab.text.toString(), readOnly: false, label: path,
      // INVARIANT: undo is the collab Y.UndoManager's (own edits only); CodeMirror's history would also undo remote edits.
      history: false,
      extensions: [createCollabExtensions({ text: binding.collab.text, file: path })],
    });
    return { flush: () => Promise.resolve(), teardown: () => view.destroy() };
  }
  const { document } = binding;
  const view = createCodeView(body, {
    path, text: document.text.replace(/\r\n/g, "\n"), readOnly: false, label: path,
    extensions: [
      ...createDocumentExtensions(document, newClientId()),
      Prec.high(keymap.of([{ key: "Mod-s", preventDefault: true, run: (target) => { documentSync(target)?.save(); return true; } }])),
    ],
  });
  return {
    flush: async () => { await documentSync(view)?.flush(); },
    teardown: () => view.destroy(),
  };
}

function mountQmd(body: HTMLElement, file: Extract<EditableFile, { kind: "qmd" }>, noteKey: string, onError?: (error: unknown) => void): Mounted {
  const { binding } = file;
  const reportError = onError ? { onError: (_action: string, error: unknown) => onError(error) } : {};
  if ("live" in binding) {
    const handle = mountNoteFile(body, { text: "", noteKey, live: binding.live, save: () => undefined, ...reportError });
    return { flush: async () => { await binding.live.persist(); }, teardown: () => handle.destroy() };
  }
  const handle = mountNoteFile(body, {
    text: binding.text, noteKey, save: binding.save, ...(binding.create ? { create: binding.create } : {}), ...reportError,
  });
  const unsubscribe = binding.subscribe((text) => handle.update(text));
  return {
    flush: () => Promise.resolve(),
    teardown: () => { unsubscribe(); handle.destroy(); },
  };
}

/** Mounts the editable view of `file` in `body`; `noteKey` keys a qmd note's cells and view state (the path by default). */
export function mountEditableView(body: HTMLElement, file: EditableFile, options: { noteKey?: string; onError?(error: unknown): void } = {}): EditableView {
  const mounted = file.kind === "text"
    ? mountText(body, file)
    : mountQmd(body, file, options.noteKey ?? file.path, options.onError ? (error) => options.onError?.(error) : undefined);
  let destroying: Promise<void> | undefined;
  const destroy = async (): Promise<void> => {
    try {
      await mounted.flush();
    } finally {
      mounted.teardown();
      file.release();
    }
  };
  return {
    flush: () => (destroying ? Promise.resolve() : mounted.flush()),
    destroy: () => { destroying ??= destroy(); return destroying; },
  };
}
