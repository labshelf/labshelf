// The reader notes' host clients: the note files, the library's paper objects and the editor options built from them.
import { type QmdPopupOptions } from "../../qmd/dom/index.js";
import { DEFAULT_NOTE_POPUP } from "../../writing/selectionPopup/prefs.js";
import type { EditorPaperObjects } from "../../qmd/dom/paperObjectPicker.js";
import { createNoteFilesClient, type NoteFileRequest, type NoteFilesPort } from "../../qmd/index.js";
import { createPaperObjectsClient } from "../../paperObjects/protocol.js";
import type { PaperObjectsPort } from "../../paperObjects/types.js";
import type { ReaderNote } from "../protocol/index.js";
import type { HostBridge } from "./readerSession.js";

const readerFiles = new WeakMap<HostBridge, NoteFilesPort>();

/** The paper note's files, asked of the host through noteFile; one client and one reply handler per bridge, since HostBridge handlers are never removed. */
function readerNoteFiles(host: HostBridge): NoteFilesPort {
  const known = readerFiles.get(host);
  if (known) { return known; }
  const listeners = new Set<(message: unknown) => void>();
  host.on("noteFile.reply", (reply) => { for (const listener of [...listeners]) { listener(reply); } });
  const files = createNoteFilesClient(
    (request) => host.post({ command: "noteFile", request: request as NoteFileRequest }),
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  );
  readerFiles.set(host, files);
  return files;
}

const readerPapers = new WeakMap<HostBridge, PaperObjectsPort>();

/** The library's paper objects, asked of the host through paperObjects; one client and one reply handler per bridge, like readerNoteFiles. */
function readerPaperObjects(host: HostBridge): PaperObjectsPort {
  const known = readerPapers.get(host);
  if (known) { return known; }
  const listeners = new Set<(message: unknown) => void>();
  host.on("paperObjects.reply", (reply) => { for (const listener of [...listeners]) { listener(reply); } });
  const port = createPaperObjectsClient(
    (request) => host.post({ command: "paperObjects", request }),
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  );
  readerPapers.set(host, port);
  return port;
}

/**
 * The `files`, `popup` (the bubble's defaults) and, where the host has a paper-object port, `paperObjects` options of the editor of note `id` of paper `paperId`:
 * From paper… starts on that paper, and new equation labels avoid those of the paper's other notes (their drafts where there are any).
 */
export function readerNoteEditorFiles(host: HostBridge, paper: { paperId: string; hasPaperObjects: boolean }, id: string, notes: () => readonly ReaderNote[], drafts: { get(id: string): string | undefined }): { files: NoteFilesPort; paperObjects?: EditorPaperObjects; popup: QmdPopupOptions } {
  const files = readerNoteFiles(host);
  // The reader keeps no editor-prefs.json, so its notes get the bubble's defaults and no Customize.
  const popup: QmdPopupOptions = { prefs: () => DEFAULT_NOTE_POPUP };
  if (!paper.hasPaperObjects) { return { files, popup }; }
  const otherBodies = (): string[] => notes().filter((note) => note.id !== id).map((note) => drafts.get(note.id) ?? note.body);
  return { files, popup, paperObjects: { port: readerPaperObjects(host), ...(paper.paperId ? { defaultPaperId: paper.paperId } : {}), otherBodies } };
}
