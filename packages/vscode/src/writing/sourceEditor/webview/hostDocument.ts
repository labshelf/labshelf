// The SourceDocument a webview editor edits over its host's messages: the main editor's own document and each consult window's text file.
import type { SourceEditorDeps } from "@labshelf/core/sourceEditor";
import type { SourceEditorInbound } from "@labshelf/core";

type SourceDocument = NonNullable<SourceEditorDeps["document"]>;
type DocumentListener = Parameters<SourceDocument["subscribe"]>[0];
type DocumentMessage = Extract<SourceEditorInbound, { type: "updates" | "resync" | "dirty" }>;
type DocumentPost = (message: { type: "push"; version: number; updates: unknown[] } | { type: "save" }) => void;

/** The document the editor edits: messages that come before the editor subscribes are kept and replayed, so no update is missed while it mounts. */
export function createHostDocument(
  init: { text: string; lineBreak: "\n" | "\r\n"; version: number; dirty: boolean },
  post: DocumentPost,
): { document: SourceDocument; deliver(message: DocumentMessage): void } {
  const listeners = new Set<DocumentListener>();
  const early: DocumentMessage[] = [];
  const dispatch = (listener: DocumentListener, message: DocumentMessage): void => {
    if (message.type === "updates") { listener.updates(message.version, message.updates); }
    else if (message.type === "resync") { listener.resync(message.text, message.version); }
    else { listener.dirty(message.dirty); }
  };
  const document: SourceDocument = {
    text: init.text, lineBreak: init.lineBreak, version: init.version, dirty: init.dirty,
    push: (version, updates) => post({ type: "push", version, updates }),
    subscribe(listener) {
      listeners.add(listener);
      for (const message of early.splice(0)) { dispatch(listener, message); }
      return () => { listeners.delete(listener); };
    },
    save: () => post({ type: "save" }),
  };
  return {
    document,
    deliver(message) {
      if (listeners.size === 0) { early.push(message); return; }
      for (const listener of listeners) { dispatch(listener, message); }
    },
  };
}
