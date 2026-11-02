// Mounts a LabShelf notes file in the notes editor webview (entry of dist/notesEditor/notesEditor.js): every item in the shared core note view, edits and cell runs as messages to the host.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "../../webview/index.js";
import "@labshelf/core/styles/qmd-editor.css";
import "@labshelf/core/styles/qmd-note-ui.css";
import "@labshelf/core/styles/qmd-drawing.css";
import "./notesEditor.css";
import type { CellResult, MathResult } from "@labshelf/core";
import { mountNoteFile, type NoteFileHandle } from "@labshelf/core/dom";
import { createWebviewNoteViewStore, createWebviewTransport } from "../../../webview/index.js";
import type { NotesEditorInbound, NotesEditorOutbound } from "../protocol.js";

const api = acquireVsCodeApi();
const transport = createWebviewTransport<NotesEditorOutbound, NotesEditorInbound>(api);
const post = (message: NotesEditorOutbound): void => transport.post(message);
const viewState = createWebviewNoteViewStore(api);

let nextId = 1;
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

/** Sends one request and resolves with the host's answer; aborting `signal` posts a cancel for it. */
function request<T>(message: Omit<Extract<NotesEditorOutbound, { type: "request" }>, "id">, signal?: AbortSignal): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: (value) => resolve(value as T), reject });
    signal?.addEventListener("abort", () => post({ type: "cancel", id }), { once: true });
    post({ ...message, id } as NotesEditorOutbound);
  });
}

const root = document.getElementById("root") ?? document.body;
let handle: NoteFileHandle | undefined;

transport.subscribe((message) => {
  if (message.type === "response") {
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.ok) entry?.resolve(message.value); else entry?.reject(new Error(message.error));
  } else if (message.type === "init") {
    handle?.destroy();
    handle = mountNoteFile(root, {
      text: message.text, noteKey: message.noteKey, viewState,
      save: (itemId, body) => post({ type: "save", itemId, body }),
      create: (itemId, body) => post({ type: "create", itemId, body }),
      ...(message.canRun ? {
        cells: {
          runCell: (params, signal) => request<CellResult>({ type: "request", method: "runCell", params }, signal),
          runMath: (params) => request<MathResult>({ type: "request", method: "runMath", params }),
          restart: async (language) => { await request({ type: "request", method: "restartCell", params: { language } }); },
          installPython: () => post({ type: "installPython" }),
        },
      } : {}),
      onError: (action, error) => { console.error(`[notesEditor] ${action}`, error); },
    });
  } else if (message.type === "update") {
    handle?.update(message.text);
  }
});

post({ type: "ready" });
