// The messages between the notes editor's webview page and its extension host (writing/notesEditor/provider.ts): the file text one way, item edits, cell, note file and paper object requests the other.
import type {
  CellLanguage, CellRequest, CellResult, MathRequest, MathResult, NoteFileReply, NoteFileRequest, PaperObjectsReply, PaperObjectsRequest,
} from "@labshelf/core";

/**
 * Host to page. `init` and `update` carry the whole file text; `canRun` says whether this host runs cells, `files` whether it
 * serves the files beside the note, `paperObjects` whether it offers From paper…, starting on `defaultPaperId` (the paper whose
 * notes.qmd this is). Note file and paper object replies answer the requests with the same requestId, bytes as base64.
 */
export type NotesEditorInbound =
  | { type: "init"; text: string; noteKey: string; canRun: boolean; files: boolean; paperObjects: boolean; defaultPaperId?: string }
  | { type: "update"; text: string }
  | { type: "response"; id: number; ok: true; value?: CellResult | MathResult }
  | { type: "response"; id: number; ok: false; error: string }
  | NoteFileReply
  | PaperObjectsReply;

/** Page to host. `save` sets an item's body, `create` appends a new item; `request` asks for a cell run, a math run or a restart, and `cancel` aborts a run; `noteFile.*` and `paperObjects.request` ask for a note file or a paper object. */
export type NotesEditorOutbound =
  | { type: "ready" }
  | { type: "save"; itemId: string; body: string }
  | { type: "create"; itemId: string; body: string }
  | { type: "request"; id: number; method: "runCell"; params: CellRequest }
  | { type: "request"; id: number; method: "runMath"; params: MathRequest }
  | { type: "request"; id: number; method: "restartCell"; params: { language: CellLanguage } }
  | { type: "cancel"; id: number }
  | { type: "installPython" }
  | NoteFileRequest
  | PaperObjectsRequest;
