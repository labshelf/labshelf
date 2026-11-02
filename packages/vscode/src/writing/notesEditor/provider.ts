// The LabShelf notes editor: a custom text editor for LabShelf notes files whose webview shows every item in the shared note view, with the file's TextDocument as the source of truth.
import * as vscode from "vscode";

import { createNonce, formatError, noteItemAddEdit, noteItemBodyEdit, type ILogger, type MathRequest, type MathResult, type NoteFileReplacement, type RunCellPort } from "@labshelf/core";
import type { CellHosts } from "../../activation/index.js";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import type { NotesEditorInbound, NotesEditorOutbound } from "./protocol.js";

export const NOTES_EDITOR_VIEW_TYPE = "labshelf.notesEditor";
const MODULE = "writing/notesEditor";

export interface NotesEditorProviderDeps {
  extensionUri: vscode.Uri;
  logger: ILogger;
  /** Runs the notes' cells; absent where cells cannot run (the web), so the cells show their stored outputs. */
  cells?: { runCell?: RunCellPort & { runMath?(request: MathRequest, signal?: AbortSignal): Promise<MathResult> }; restartCell?: CellHosts["restartCell"]; installPython?(): void };
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
      // Item edits land one after another, each computed on the text the previous one left.
      let edits: Promise<unknown> = Promise.resolve();
      const applyItem = (message: Extract<NotesEditorOutbound, { type: "save" | "create" }>): void => {
        edits = edits.then(async () => {
          try {
            const edit = itemMessageEdit(document, message);
            if (edit && !(await vscode.workspace.applyEdit(edit))) { throw new Error("VS Code did not apply the edit."); }
          } catch (error) {
            void logger.error(MODULE, error, { action: message.type, itemId: message.itemId });
            void vscode.window.showErrorMessage(`LabShelf: could not save the note — ${formatError(error)}`);
            post({ type: "update", text: document.getText() });
          }
        });
      };
      const subscriptions: vscode.Disposable[] = [
        vscode.workspace.onDidChangeTextDocument((event) => {
          if (event.document.uri.toString() === document.uri.toString() && event.contentChanges.length > 0) { post({ type: "update", text: document.getText() }); }
        }),
        panel.webview.onDidReceiveMessage((raw: NotesEditorOutbound) => {
          if (raw.type === "ready") {
            ready = true;
            post({ type: "init", text: document.getText(), noteKey, canRun: cells.canRun });
          } else if (raw.type === "save" || raw.type === "create") {
            applyItem(raw);
          } else {
            cells.receive(raw);
          }
        }),
      ];
      panel.onDidDispose(() => { cells.dispose(); while (subscriptions.length) { subscriptions.pop()?.dispose(); } });
      panel.webview.html = await notesEditorHtml(panel.webview, extensionUri);
    },
  };
}
