// Declares the in-process events the extension's parts use to follow library changes without importing each other.
// A listener that throws is reported by VS Code and does not stop the other listeners.
import * as vscode from "vscode";
import type { PaperRecord } from "@labshelf/core";

export interface LibraryEvents {
  paperAdded: vscode.EventEmitter<PaperRecord>;
  paperUpdated: vscode.EventEmitter<PaperRecord>;
  paperDeleted: vscode.EventEmitter<{ id: string }>;
  /** An annotation was created, edited or deleted in an open reader. */
  annotationChanged: vscode.EventEmitter<{ paperId: string }>;
  pdfViewerClosed: vscode.EventEmitter<{ paperId: string }>;
}

export function createLibraryEvents(): LibraryEvents {
  return {
    paperAdded: new vscode.EventEmitter(),
    paperUpdated: new vscode.EventEmitter(),
    paperDeleted: new vscode.EventEmitter(),
    annotationChanged: new vscode.EventEmitter(),
    pdfViewerClosed: new vscode.EventEmitter(),
  };
}

/** Listens for a paper being added, updated or deleted. */
export function onPaperChange(events: LibraryEvents, listener: () => void): vscode.Disposable {
  return vscode.Disposable.from(events.paperAdded.event(listener), events.paperUpdated.event(listener), events.paperDeleted.event(listener));
}
