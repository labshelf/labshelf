// The LabShelf editor for .tex and .typ files (D1): a custom text editor whose webview hosts the core source editor over the file's TextDocument, one authority per document shared by every panel on it, and the project files it may read.
import * as vscode from "vscode";

import {
  createNonce, createSourceAuthority, parseSourceEditorOutbound,
  type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type SourceAuthority, type SourceEditorInbound, type SourceEditorOutbound,
} from "@labshelf/core";
import type { SourceFileComments } from "../../collab/comments.js";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import type { ActiveSource, SourceView } from "../activeSource.js";
import { deriveBuildRootPath, findOwningProject, type WritingProjects } from "../projects/index.js";
import { createSourceBridges, type SourceBridges } from "./bridges.js";
import { createDocumentSync } from "./documentSync.js";

export const SOURCE_EDITOR_VIEW_TYPE = "labshelf.sourceEditor";

export interface SourceEditorProviderDeps {
  extensionUri: vscode.Uri;
  /** The writing projects a file belongs to, and the disk its project files are read from. */
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "fs">;
  logger: ILogger;
  /** Each open panel registers its view here, so Build, Show in Preview and reverse search find it. */
  activeSource: Pick<ActiveSource, "register">;
  /** The open library's papers, for the editor's citations. */
  library: { listPapers(): Promise<PaperRecord[]> };
  /** The papers' notes, for the "N notes" gutter. */
  paperNotes: Pick<PaperNotesStore, "read">;
  /** Where the equations and outputs of a project's notes and its cited papers' notes are read from, for "Insert from note". */
  noteSource(project: NonNullable<ReturnType<typeof findOwningProject>>): NoteInsertSource;
  /** Shows a paper's notes where the library page does. */
  openNotes(paperId: string): void;
  /** The comment manager's port, read when a panel opens; absent where comments do not run (the web). */
  comments?(): SourceFileComments | undefined;
}

type Request = Extract<SourceEditorOutbound, { type: "request" }>;
type Response = Extract<SourceEditorInbound, { type: "response" }>;

/** <extension>/dist/sourceEditor, for localResourceRoots. */
function bundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "sourceEditor");
}

async function sourceEditorHtml(webview: vscode.Webview, extensionUri: vscode.Uri): Promise<string> {
  const dir = bundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "sourceEditor.js");
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: "LabShelf Editor", heading: "Source editor bundle not built", file: "dist/sourceEditor/sourceEditor.js", reopen: "the file" });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: "LabShelf Editor",
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, "sourceEditor.css")).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
  });
}

function lineBreakOf(document: vscode.TextDocument): "\n" | "\r\n" {
  return document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}

/** The first message a panel gets: the file, its project and the authority's text, LF inside the editor. */
function initMessage(document: vscode.TextDocument, authority: SourceAuthority, projects: SourceEditorProviderDeps["projects"]): SourceEditorInbound {
  const file = document.uri.fsPath;
  const project = document.uri.scheme === "file" ? findOwningProject(projects, file) : undefined;
  const path = project ? deriveBuildRootPath(projects.paths, project, file) : projects.paths.basename(file);
  return {
    type: "init", path, projectId: project?.settings.id ?? "", language: file.endsWith(".typ") ? "typst" : "latex",
    text: authority.text().replace(/\r\n/g, "\n"), lineBreak: lineBreakOf(document), version: authority.version,
    readOnly: false, dirty: document.isDirty,
  };
}

/** Answers a request of the page from the bridges; a rejection is its error response. */
async function answerRequest(request: Request, bridges: SourceBridges): Promise<Response> {
  const { id, method, params } = request;
  try {
    return { type: "response", id, ok: true, value: await bridges.handle(method, params) };
  } catch (error) {
    return { type: "response", id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Notes of a file that belongs to no project: nothing to list or read. */
const NO_NOTES: NoteInsertSource = {
  listProjectNotes: async () => [], readProjectNote: async () => undefined, listCitedPaperIds: async () => [], readPaperNote: async () => undefined,
};

/** The authorities of the documents open in a LabShelf editor: created with the first panel on a document, dropped with the last. */
function createAuthorities() {
  const open = new Map<string, { authority: SourceAuthority; panels: number }>();
  return {
    acquire(document: vscode.TextDocument): SourceAuthority {
      const key = document.uri.toString();
      const entry = open.get(key) ?? { authority: createSourceAuthority({ text: document.getText(), lineBreak: lineBreakOf(document) }), panels: 0 };
      entry.panels += 1;
      open.set(key, entry);
      return entry.authority;
    },
    release(document: vscode.TextDocument): void {
      const key = document.uri.toString();
      const entry = open.get(key);
      if (!entry) { return; }
      entry.panels -= 1;
      if (entry.panels <= 0) { open.delete(key); }
    },
  };
}

export function createSourceEditorProvider(deps: SourceEditorProviderDeps): vscode.CustomTextEditorProvider {
  const authorities = createAuthorities();
  return {
    async resolveCustomTextEditor(document, panel) {
      const { extensionUri, logger } = deps;
      panel.webview.options = { enableScripts: true, localResourceRoots: [bundleDirectory(extensionUri), webviewChunksDir(extensionUri)] };
      const authority = authorities.acquire(document);
      const project = document.uri.scheme === "file" ? findOwningProject(deps.projects, document.uri.fsPath) : undefined;
      const comments = deps.comments?.();
      const bridges = createSourceBridges({
        comments,
        uri: document.uri, projectRoot: project ? vscode.Uri.file(project.folder) : undefined, library: deps.library,
        notes: { ...(project ? deps.noteSource(project) : NO_NOTES), read: (paperId) => deps.paperNotes.read(paperId) },
        openNotes: deps.openNotes, logger,
      });
      // Nothing reaches the page before it is listening; its init carries everything sent until then.
      let ready = false;
      const post = (message: SourceEditorInbound | { type: string; [key: string]: unknown }): void => {
        if (ready) { void panel.webview.postMessage(message); }
      };
      const sync = createDocumentSync({ document, authority, applyEdit: (edit) => vscode.workspace.applyEdit(edit), post, logger });
      // The editor takes part in activeSource: its focus makes it the current source, and its cursor line answers Show in Preview.
      const focus = new vscode.EventEmitter<boolean>();
      let cursorLine = 1;
      let pendingReveal: number | undefined;
      const view: SourceView = {
        uri: document.uri,
        line: () => cursorLine,
        reveal: (line) => {
          panel.reveal(panel.viewColumn, true);
          if (ready) { post({ type: "reveal", line }); } else { pendingReveal = line; }
        },
        // The editor title actions and the citation insert reach the page as one command each.
        updates: {
          insertText: (text) => post({ type: "command", command: { kind: "insertText", text } }),
          insertSnippet: (snippet) => post({ type: "command", command: { kind: "insertSnippet", snippet } }),
          wrap: (style) => post({ type: "command", command: { kind: "wrap", style } }),
        },
      };
      // The file's comment threads, followed from the page's first ready until the panel closes.
      let commentWatch: vscode.Disposable | undefined;
      const subscriptions: vscode.Disposable[] = [
        focus,
        { dispose: () => commentWatch?.dispose() },
        deps.activeSource.register(view, focus.event),
        panel.onDidChangeViewState(() => focus.fire(panel.active)),
        // The build's and other extensions' diagnostics of this file, whenever any collection changes them.
        vscode.languages.onDidChangeDiagnostics((event) => {
          const key = document.uri.toString();
          if (event.uris.some((changed) => changed.toString() === key)) { post(bridges.problems()); }
        }),
        panel.webview.onDidReceiveMessage((raw: unknown) => {
          const message = parseSourceEditorOutbound(raw);
          if (!message) { return; }
          if (message.type === "ready") {
            ready = true;
            post(initMessage(document, authority, deps.projects));
            post(bridges.problems());
            commentWatch?.dispose();
            commentWatch = bridges.watchComments(post);
            if (pendingReveal !== undefined) { post({ type: "reveal", line: pendingReveal }); pendingReveal = undefined; }
          } else if (message.type === "focus") {
            focus.fire(message.focused);
          } else if (message.type === "selection") {
            cursorLine = message.line;
          } else if (message.type === "request") {
            void answerRequest(message, bridges).then(post);
          } else {
            void sync.receive(message);
          }
        }),
      ];
      panel.onDidDispose(() => {
        sync.dispose();
        while (subscriptions.length) { subscriptions.pop()?.dispose(); }
        authorities.release(document);
      });
      panel.webview.html = await sourceEditorHtml(panel.webview, extensionUri);
    },
  };
}
