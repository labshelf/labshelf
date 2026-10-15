/**
 * Implements the reader host ports in VS Code: notices, clipboard, links, the annotation file save and sidecar events.
 */
import * as vscode from "vscode";
import type { ExportAnnotationsPorts, NoticeKind, PaperRecord, ReaderHostPorts, SidecarChange } from "@labshelf/core";
import type { LibraryEvents } from "../events/index.js";

export type VsCodeOutputPorts = Pick<ReaderHostPorts, "writeClipboard" | "notify" | "openExternal" | "saveAnnotations">;

/**
 * Confirmations go to the status bar so they never steal focus from the reader.
 */
export function notifyInVsCode(message: string, kind: NoticeKind): void {
  if (kind === "ok") {
    vscode.window.setStatusBarMessage(message, 2500);
  } else if (kind === "error") {
    void vscode.window.showErrorMessage(`LabShelf: ${message}`);
  } else {
    void vscode.window.showInformationMessage(message);
  }
}

/**
 * Asks where to save, defaulting to <paper folder>/annotations.md, then opens the file beside the reader.
 * @returns resolves once the file is written and shown, or at once when the dialog is cancelled.
 */
async function saveAnnotationsFile(paper: PaperRecord, markdown: string): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(paper.path), "annotations.md"),
    filters: { Markdown: ["md"] },
  });
  if (!uri) { return; }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown));
  await vscode.window.showTextDocument(uri, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

/**
 * @returns the clipboard, notice, link and file ports for one paper.
 */
export function createVsCodeOutputPorts(paper: PaperRecord): VsCodeOutputPorts {
  return {
    writeClipboard: async (text) => { await vscode.env.clipboard.writeText(text); },
    notify: notifyInVsCode,
    openExternal: async (url) => { await vscode.env.openExternal(vscode.Uri.parse(url)); },
    saveAnnotations: (markdown) => saveAnnotationsFile(paper, markdown),
  };
}

/**
 * The ports the Markdown export needs outside a reader panel (the export palette command).
 * @returns export ports over the given sidecar store.
 */
export function createVsCodeExportPorts(paper: PaperRecord, store: ExportAnnotationsPorts["store"]): ExportAnnotationsPorts {
  return { paper, store, ...createVsCodeOutputPorts(paper) };
}

/**
 * The list webview and the sync controller listen for annotation events; theme changes concern only the reader.
 * @returns a sidecarChanged port that republishes annotation changes as an annotationChanged event.
 */
export function emitSidecarChanges(events: LibraryEvents, paperId: string): (change: SidecarChange) => void {
  return (change) => {
    switch (change.kind) {
      case "annotationCreated":
      case "annotationUpdated":
      case "annotationDeleted": events.annotationChanged.fire({ paperId }); break;
      case "theme": break;
    }
  };
}
