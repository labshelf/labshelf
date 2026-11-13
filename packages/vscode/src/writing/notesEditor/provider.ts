// The LabShelf notes editor: a custom text editor for LabShelf notes files whose webview shows every item in the shared note view, with the file's TextDocument as the source of truth.
import * as vscode from "vscode";

import {
  answerNoteFileRequest, answerPaperObjectsRequest, createNonce, formatError, isNoteFileRequest, isPaperObjectsRequest, noteItemAddEdit, noteItemBodyEdit,
  parsePaperLink, parseSelectionPopupMessage, unsupportedNoteFileReply, unsupportedPaperObjectsReply,
  type ILogger, type MathRequest, type MathResult, type NoteFileIo, type NoteFileReplacement, type NoteFileRequest, type PaperObjectsPort, type PaperObjectsRequest, type RunCellPort,
} from "@labshelf/core";
import type { CellHosts } from "../../activation/index.js";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import type { EditorPrefsHost } from "../sourceEditor/index.js";
import type { NotesEditorInbound, NotesEditorOutbound } from "./protocol.js";
import { createAutosave, type DiskMerge } from "../../localSync/index.js";

export const NOTES_EDITOR_VIEW_TYPE = "labshelf.notesEditor";
const MODULE = "writing/notesEditor";

export interface NotesEditorProviderDeps {
  extensionUri: vscode.Uri;
  logger: ILogger;
  /** Runs the notes' cells; absent where cells cannot run (the web), so the cells show their stored outputs. */
  cells?: { runCell?: RunCellPort & { runMath?(request: MathRequest, signal?: AbortSignal): Promise<MathResult> }; restartCell?: CellHosts["restartCell"]; installPython?(): void };
  /** Serves the files beside a note (assets/, a chart's table) in `folderOf(document)`; absent, or a folder `io` cannot reach (undefined), means the page has no files port. */
  files?: { io: NoteFileIo; folderOf(uri: vscode.Uri): string | undefined };
  /** Offers From paper…; absent where PDF regions cannot be rendered (the web). */
  paperObjects?: PaperObjectsPort;
  /** The id of the library paper whose notes.qmd `uri` is, so From paper… starts on it; undefined for any other notes file. */
  paperOf?(uri: vscode.Uri): Promise<string | undefined>;
  /** The bubble's settings in the open library's editor-prefs.json; absent, the page uses the defaults and offers no Customize. */
  editorPrefs?: Pick<EditorPrefsHost, "notePopup" | "setNotePopup" | "onNotePopupChange">;
  /** Opens the paper a labshelf: link names, at its page. */
  openPaperLink?(href: string): Promise<void>;
  /** Takes a disk change of the open notes file into its dirty document by a merge. */
  diskMerge?: DiskMerge;
}

/** <extension>/dist/notesEditor, for localResourceRoots. */
function bundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "notesEditor");
}

async function notesEditorHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = bundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "notesEditor.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "LabShelf Notes", heading: "Notes editor bundle not built", file: "dist/notesEditor/notesEditor.js", reopen: "the file" });
  }
  return renderHtmlShell({
    nonce: createNonce(), cspSource: webview.cspSource, title: "LabShelf Notes",
    // blob: images: the note shows its assets and the From paper… previews as object URLs, and the chart export loads its SVG through one.
    images: "qmd",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "notesEditor.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

/** The WorkspaceEdit of one replacement of the document's text, or undefined when there is nothing to replace. */
function toWorkspaceEdit(document: Pick<vscode.TextDocument, "uri" | "positionAt">, replacement: NoteFileReplacement | undefined): vscode.WorkspaceEdit | undefined {
  if (!replacement) return undefined;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, new vscode.Range(document.positionAt(replacement.start), document.positionAt(replacement.end)), replacement.insert);
  return edit;
}

/** The WorkspaceEdit an item message of the page makes on the document: a new body for an item, or a new item at the end. Throws when the item writer rejects it. */
export function itemMessageEdit(document: Pick<vscode.TextDocument, "uri" | "positionAt" | "getText">, message: Extract<NotesEditorOutbound, { type: "save" | "create" }>, now: () => string = () => new Date().toISOString()): vscode.WorkspaceEdit | undefined {
  const text = document.getText();
  return toWorkspaceEdit(document, message.type === "save"
    ? noteItemBodyEdit(text, message.itemId, message.body)
    : noteItemAddEdit(text, { id: message.itemId, body: message.body, created: now() }));
}

type Post = (message: NotesEditorInbound) => void;

/** Answers the page's cell requests from the extension's cell hosts; each run can be cancelled by its request id. */
function createCellBridge(cells: NotesEditorProviderDeps["cells"], noteKey: string, post: Post) {
  const running = new Map<number, AbortController>();
  const answer = (id: number, work: (signal: AbortSignal) => Promise<unknown>): void => {
    const controller = new AbortController();
    running.set(id, controller);
    void work(controller.signal).then(
      (value) => post({ type: "response", id, ok: true, ...(value === undefined ? {} : { value: value as never }) }),
      (error: unknown) => post({ type: "response", id, ok: false, error: formatError(error) }),
    ).finally(() => running.delete(id));
  };
  const runCell = cells?.runCell;
  return {
    canRun: runCell !== undefined,
    receive(message: Extract<NotesEditorOutbound, { type: "request" | "cancel" | "installPython" }>): void {
      if (message.type === "cancel") { running.get(message.id)?.abort(); return; }
      if (message.type === "installPython") { cells?.installPython?.(); return; }
      if (message.method === "runCell") {
        answer(message.id, (signal) => (runCell ? runCell(message.params, signal) : Promise.reject(new Error("This host has no cell runner."))));
      } else if (message.method === "runMath") {
        const runMath = runCell?.runMath;
        answer(message.id, (signal) => (runMath ? runMath.call(runCell, message.params, signal) : Promise.reject(new Error("This host has no math runner."))));
      } else {
        const { restartCell } = cells ?? {};
        answer(message.id, async () => { await restartCell?.(noteKey, message.params.language); });
      }
    },
    dispose(): void { for (const controller of running.values()) controller.abort(); running.clear(); },
  };
}

/** What the page learns when it is ready: the file text and what this host serves it. */
export async function initMessage(deps: NotesEditorProviderDeps, document: vscode.TextDocument, noteKey: string, canRun: boolean): Promise<NotesEditorInbound> {
  const paperId = deps.paperObjects ? await deps.paperOf?.(document.uri).catch(() => undefined) : undefined;
  const notePopup = await deps.editorPrefs?.notePopup().catch(() => undefined);
  return {
    type: "init", text: document.getText(), noteKey, canRun, files: deps.files?.folderOf(document.uri) !== undefined, paperObjects: deps.paperObjects !== undefined,
    ...(paperId ? { defaultPaperId: paperId } : {}), ...(notePopup ? { notePopup } : {}),
  };
}

/** The reply to a note file or paper object request of the page; never rejects. */
export async function answerFileRequest(deps: NotesEditorProviderDeps, document: vscode.TextDocument, request: NoteFileRequest | PaperObjectsRequest): Promise<NotesEditorInbound> {
  if (isPaperObjectsRequest(request)) {
    return deps.paperObjects ? answerPaperObjectsRequest(deps.paperObjects, request) : unsupportedPaperObjectsReply(request);
  }
  const folder = deps.files?.folderOf(document.uri);
  return deps.files && folder !== undefined ? answerNoteFileRequest(deps.files.io, folder, request) : unsupportedNoteFileReply(request);
}

/** A labshelf: link opens its paper; any other link opens outside VS Code. */
async function openLink(deps: NotesEditorProviderDeps, href: string): Promise<void> {
  if (parsePaperLink(href)) { await deps.openPaperLink?.(href); return; }
  const uri = vscode.Uri.parse(href, true);
  if (uri.scheme === "http" || uri.scheme === "https" || uri.scheme === "mailto") { await vscode.env.openExternal(uri); }
}

/** Applies the page's item edits one after another, each computed on the text the previous one left, and schedules the autosave; a failed edit is reported and the page gets the document's text back. */
function createItemApplier(
  document: vscode.TextDocument, logger: NotesEditorProviderDeps["logger"], autosave: ReturnType<typeof createAutosave>, post: Post,
): (message: Extract<NotesEditorOutbound, { type: "save" | "create" }>) => void {
  let edits: Promise<unknown> = Promise.resolve();
  return (message) => {
    edits = edits.then(async () => {
      try {
        const edit = itemMessageEdit(document, message);
        if (edit && !(await vscode.workspace.applyEdit(edit))) { throw new Error("VS Code did not apply the edit."); }
        if (edit) { autosave.schedule(document); }
      } catch (error) {
        void logger.error(MODULE, error, { action: message.type, itemId: message.itemId });
        void vscode.window.showErrorMessage(`LabShelf: could not save the note — ${formatError(error)}`);
        post({ type: "update", text: document.getText() });
      }
    });
  };
}

export function createNotesEditorProvider(deps: NotesEditorProviderDeps): vscode.CustomTextEditorProvider {
  return {
    async resolveCustomTextEditor(document, panel) {
      const { extensionUri, logger } = deps;
      panel.webview.options = { enableScripts: true, localResourceRoots: [bundleDirectory(extensionUri), webviewChunksDir(extensionUri)] };
      let ready = false;
      const post: Post = (message) => { if (ready) { void panel.webview.postMessage(message); } };
      // The cells of one notes file share a process per language; the file is the note.
      const noteKey = `file:${document.uri.toString()}`;
      const cells = createCellBridge(deps.cells, noteKey, post);
      // A page edit is saved 300 ms after the last one, only while the document is still dirty.
      const autosave = createAutosave();
      const applyItem = createItemApplier(document, logger, autosave, post);
      const subscriptions: vscode.Disposable[] = [
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length > 0) { post({ type: "update", text: document.getText() }); }
        }),
        panel.webview.onDidReceiveMessage((raw: NotesEditorOutbound) => {
          if (raw.type === "ready") {
            ready = true;
            void initMessage(deps, document, noteKey, cells.canRun).then(post);
          } else if (raw.type === "save" || raw.type === "create") {
            applyItem(raw);
          } else if (raw.type === "setNotePopup") {
            const next = parseSelectionPopupMessage(raw.notePopup);
            if (next) { void deps.editorPrefs?.setNotePopup(next).catch((error: unknown) => logger.error(MODULE, error, { action: "setNotePopup" })); }
          } else if (raw.type === "openLink") {
            void openLink(deps, raw.href).catch((error: unknown) => logger.error(MODULE, error, { action: "openLink" }));
          } else if (isNoteFileRequest(raw) || isPaperObjectsRequest(raw)) {
            void answerFileRequest(deps, document, raw).then(post);
          } else {
            cells.receive(raw);
          }
        }),
      ];
      const unsubscribePopup = deps.editorPrefs?.onNotePopupChange((notePopup) => post({ type: "notePopup", notePopup }));
      if (unsubscribePopup) { subscriptions.push({ dispose: unsubscribePopup }); }
      const tracked = deps.diskMerge?.track(document);
      if (tracked) { subscriptions.push(tracked); }
      panel.onDidDispose(() => { autosave.dispose(); cells.dispose(); while (subscriptions.length) { subscriptions.pop()?.dispose(); } });
      panel.webview.html = await notesEditorHtml(panel.webview, extensionUri);
    },
  };
}
