// One reader's host side, apart from where its page lives: the controller over the source's ports, the settings it follows and its consult port.
// A reader panel owns one; the LabShelf editor's inline preview owns one inside its own webview.
import * as vscode from "vscode";
import {
  ReaderHostController,
  answerNoteFileRequest,
  type CiteRequest,
  type ConsultOutbound,
  type HostToWebview,
  type NoteFileRequest,
} from "@labshelf/core";
import { followReaderSettings, getReaderPrefs } from "./followNotes.js";
import { createVsCodeOutputPorts, type ReaderPanelDeps, type ReaderSource } from "./panel.js";
import { readAutoReaderTheme } from "./shell.js";

/** Where an endpoint's reader page lives: how to reach it and how it names files. */
export interface ReaderEndpointIo {
  post(message: HostToWebview): void;
  /** The webview URI the page fetches a file by; the file must lie under a resource root of the webview. */
  asWebviewUri(uri: vscode.Uri): vscode.Uri;
  /** Names what the reader shows, where the page has a title (a panel's tab). */
  setTitle?(title: string): void;
}

/** The host side of one reader. */
export interface ReaderEndpoint {
  /** Drives the reader: page jumps, reloads, build status and revealed points. */
  readonly controller: ReaderHostController;
  /** Shows another PDF; it must lie under the `rootDir` of the source the endpoint was created with. */
  showDocument(pdf: vscode.Uri, title: string): void;
  dispose(): void;
}

// Every live reader, so a custom theme saved in one reaches the others.
const liveEndpoints = new Set<ReaderEndpoint>();

/** Builds the host side of a reader over a source; the caller routes the page's messages to `controller.handle`. */
export function createReaderEndpoint(deps: ReaderPanelDeps, source: ReaderSource, io: ReaderEndpointIo): ReaderEndpoint {
  const { paper } = source;
  let disposed = false;
  const post = (message: HostToWebview): void => { if (!disposed) { io.post(message); } };
  const consult = deps.consult?.(post);
  const controller = new ReaderHostController({
    paper,
    store: source.store,
    // The details live in the list tab's right pane, so the button shows the paper there.
    toggleDetails: async (paperId) => { await vscode.commands.executeCommand("labshelf.revealPaper", paperId); },
    post,
    getPrefs: getReaderPrefs,
    autoTheme: readAutoReaderTheme,
    ...createVsCodeOutputPorts(paper),
    ...(deps.cite ? { cite: (request: CiteRequest) => deps.cite!(paper, request) } : {}),
    ...(source.notes ? { notes: source.notes } : {}),
    ...(source.themes ? { themes: source.themes } : {}),
    ...(deps.runCell ? { runCell: deps.runCell } : {}),
    ...(deps.runCell?.runMath ? { runMath: deps.runCell.runMath } : {}),
    ...(deps.restartCell ? { restartCell: deps.restartCell } : {}), ...(deps.installPython ? { installPython: deps.installPython } : {}),
    ...(deps.extractEquation ? { extractEquation: deps.extractEquation } : {}),
    ...(deps.paperObjects ? { paperObjects: deps.paperObjects } : {}),
    ...(consult ? { consult: { handle: (message: ConsultOutbound) => consult.handle(message) } } : {}),
    ...(deps.noteFileIo ? { noteFiles: (request: NoteFileRequest) => answerNoteFileRequest(deps.noteFileIo!, paper.path, request) } : {}),
    logger: deps.logger,
    sidecarChanged: (change) => {
      // A custom theme saved here reaches every other open reader; this one already has the list.
      if (change.kind === "customThemes") {
        for (const other of liveEndpoints) { if (other !== endpoint) { other.controller.onCustomThemesChange(change.themes); } }
      }
      source.sidecarChanged?.(change);
    },
    ...(source.preview ? { preview: source.preview } : {}),
  }, source.page !== undefined ? { page: source.page } : {});
  const subscriptions = followReaderSettings(controller);
  const endpoint: ReaderEndpoint = {
    controller,
    showDocument(pdf, title) {
      io.setTitle?.(title);
      controller.reloadDocument(io.asWebviewUri(pdf).toString());
    },
    dispose() {
      if (disposed) { return; }
      disposed = true;
      liveEndpoints.delete(endpoint);
      consult?.dispose();
      while (subscriptions.length) { subscriptions.pop()?.dispose(); }
    },
  };
  liveEndpoints.add(endpoint);
  return endpoint;
}
