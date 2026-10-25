/**
 * Opens a library paper in a reader panel, with its sidecar store and the events the list listens to.
 */
import * as vscode from "vscode";
import { createPaperFiles, type ILogger, type PaperDataStore, type PaperRecord } from "@labshelf/core";
import { ReaderPanel, type ReaderPanelDeps } from "./ReaderPanel.js";
import { emitSidecarChanges } from "./readerHostPorts.js";
import type { LibraryEvents } from "../library/index.js";

export interface PdfViewerDeps extends ReaderPanelDeps {
  events: LibraryEvents;
  store: PaperDataStore;
  logger: ILogger;
}

export interface OpenOptions {
  /** Jump to this page once open (or immediately, when the paper's panel already exists). */
  page?: number;
}

export class PdfViewerPanel {
  /**
   * Reveals the paper's panel if one is open, or opens a new one keyed by the paper id.
   */
  static createOrShow(deps: PdfViewerDeps, paper: PaperRecord, options: OpenOptions = {}): void {
    const paperDirUri = vscode.Uri.file(paper.path);
    ReaderPanel.createOrShow(deps, {
      key: paper.id,
      paper,
      store: deps.store,
      pdfUri: createPaperFiles(paperDirUri, vscode.Uri.joinPath).pdf,
      rootDir: paperDirUri,
      sidecarChanged: emitSidecarChanges(deps.events, paper.id),
      onClosed: () => deps.events.pdfViewerClosed.fire({ paperId: paper.id }),
      ...(options.page !== undefined ? { page: options.page } : {}),
    });
  }
}
