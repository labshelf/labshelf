// The LabShelf editor for .tex and .typ files (D1): a custom text editor whose webview hosts the core source editor over the file's TextDocument, one authority per document shared by every panel on it, and the project files it may read.
import * as vscode from "vscode";

import {
  createNonce, createSourceAuthority, parseSourceEditorOutbound,
  type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type SourceAuthority, type SourceEditorInbound, type SourceEditorOutbound,
} from "@labshelf/core";
import type { SourceFileComments } from "../../collab/index.js";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import type { ActiveSource, SourceView } from "../activeSource.js";
import { deriveBuildRootPath, findOwningProject, type WritingProjects } from "../projects/index.js";
import { createSourceBridges, type SourceBridges } from "./bridges.js";
import { createDocumentSync } from "./documentSync.js";
import { createSourcePresence, currentSourcePresence, type PeerSelection } from "./presenceBridge.js";

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

type Post = (message: SourceEditorInbound | { type: string; [key: string]: unknown }) => void;
type Project = NonNullable<ReturnType<typeof findOwningProject>>;

/** The channel to the page: nothing reaches it before it is listening (its init carries everything sent until then), and a reveal asked before waits for it. */
function createPage(panel: vscode.WebviewPanel) {
  let ready = false;
  let pendingReveal: number | undefined;
  const post: Post = (message) => {
    if (ready) { void panel.webview.postMessage(message); }
  };
  return {
    post,
    becomeReady(): void { ready = true; },
    reveal(line: number): void {
      panel.reveal(panel.viewColumn, true);
      if (ready) { post({ type: "reveal", line }); } else { pendingReveal = line; }
    },
    flushReveal(): void {
      if (pendingReveal === undefined) { return; }
      post({ type: "reveal", line: pendingReveal });
      pendingReveal = undefined;
    },
  };
}

type Page = ReturnType<typeof createPage>;

/** The editor takes part in activeSource: its cursor line answers Show in Preview, and the editor title actions and the citation insert reach the page as one command each. */
function createSourceView(document: vscode.TextDocument, page: Page, cursor: { line: number }): SourceView {
  return {
    uri: document.uri,
    line: () => cursor.line,
    reveal: (line) => page.reveal(line),
    updates: {
      insertText: (text) => page.post({ type: "command", command: { kind: "insertText", text } }),
      insertSnippet: (snippet) => page.post({ type: "command", command: { kind: "insertSnippet", snippet } }),
      wrap: (style) => page.post({ type: "command", command: { kind: "wrap", style } }),
    },
  };
}

function createPanelBridges(deps: SourceEditorProviderDeps, document: vscode.TextDocument, project: Project | undefined): SourceBridges {
  return createSourceBridges({
    comments: deps.comments?.(),
    uri: document.uri, projectRoot: project ? vscode.Uri.file(project.folder) : undefined, library: deps.library,
    notes: { ...(project ? deps.noteSource(project) : NO_NOTES), read: (paperId) => deps.paperNotes.read(paperId) },
    openNotes: deps.openNotes, logger: deps.logger,
  });
}

/** The last peers posted to the page, resent once the page is ready. */
interface PeerMemory { last?: PeerSelection[] }

/** In a shared project the page's selection is published and the peers on the file are posted back. */
function openPresence(document: vscode.TextDocument, post: Post, peers: PeerMemory): ReturnType<typeof createSourcePresence> | undefined {
  const sharing = currentSourcePresence();
  return sharing && createSourcePresence({
    document,
    publish: (uri, selection) => sharing.publishSelection(uri, selection),
    unpublish: (uri) => sharing.dropSelection(uri),
    subscribePeers: (uri, listener) => sharing.peersOf(uri, listener),
    post: (message) => {
      if (message.type === "peers") { peers.last = message.peers; }
      post(message);
    },
  });
}

/** Everything one open panel works with. */
interface PanelSession {
  document: vscode.TextDocument;
  authority: SourceAuthority;
  projects: SourceEditorProviderDeps["projects"];
  page: Page;
  bridges: SourceBridges;
  sync: ReturnType<typeof createDocumentSync>;
  focus: vscode.EventEmitter<boolean>;
  cursor: { line: number };
  peers: PeerMemory;
  presence: ReturnType<typeof createSourcePresence> | undefined;
  /** The file's comment threads, followed from the page's first ready until the panel closes. */
  commentWatch: { current?: vscode.Disposable };
}

/** The page is listening: send it the file, its problems, comments, the peers and any reveal that waited. */
function sendReady(session: PanelSession): void {
  const { page, bridges, commentWatch } = session;
  page.becomeReady();
  page.post(initMessage(session.document, session.authority, session.projects));
  page.post(bridges.problems());
  commentWatch.current?.dispose();
  commentWatch.current = bridges.watchComments(page.post);
  if (session.peers.last) { page.post({ type: "peers", peers: session.peers.last }); }
  page.flushReveal();
}

function handlePageMessage(raw: unknown, session: PanelSession): void {
  const message = parseSourceEditorOutbound(raw);
  if (!message) { return; }
  if (message.type === "ready") {
    sendReady(session);
  } else if (message.type === "focus") {
    session.focus.fire(message.focused);
  } else if (message.type === "selection") {
    session.cursor.line = message.line;
    session.presence?.selection(message);
  } else if (message.type === "request") {
    void answerRequest(message, session.bridges).then(session.page.post);
  } else {
    void session.sync.receive(message);
  }
}

/** What the panel listens to; the panel's disposal releases them all. */
function listenToPanel(deps: SourceEditorProviderDeps, panel: vscode.WebviewPanel, session: PanelSession, view: SourceView): vscode.Disposable[] {
  const { document, focus, page, bridges } = session;
  return [
    focus,
    { dispose: () => session.commentWatch.current?.dispose() },
    { dispose: () => session.presence?.dispose() },
    deps.activeSource.register(view, focus.event),
    panel.onDidChangeViewState(() => focus.fire(panel.active)),
    // The build's and other extensions' diagnostics of this file, whenever any collection changes them.
    vscode.languages.onDidChangeDiagnostics((event) => {
      const key = document.uri.toString();
      if (event.uris.some((changed) => changed.toString() === key)) { page.post(bridges.problems()); }
    }),
    panel.webview.onDidReceiveMessage((raw: unknown) => handlePageMessage(raw, session)),
  ];
}

export function createSourceEditorProvider(deps: SourceEditorProviderDeps): vscode.CustomTextEditorProvider {
  const authorities = createAuthorities();
  return {
    async resolveCustomTextEditor(document, panel) {
      const { extensionUri, logger } = deps;
      panel.webview.options = { enableScripts: true, localResourceRoots: [bundleDirectory(extensionUri), webviewChunksDir(extensionUri)] };
      const authority = authorities.acquire(document);
      const project = document.uri.scheme === "file" ? findOwningProject(deps.projects, document.uri.fsPath) : undefined;
      const page = createPage(panel);
      const peers: PeerMemory = {};
      const cursor = { line: 1 };
      const session: PanelSession = {
        document, authority, projects: deps.projects, page, cursor, peers, commentWatch: {},
        bridges: createPanelBridges(deps, document, project),
        sync: createDocumentSync({ document, authority, applyEdit: (edit) => vscode.workspace.applyEdit(edit), post: page.post, logger }),
        focus: new vscode.EventEmitter<boolean>(),
        presence: project ? openPresence(document, page.post, peers) : undefined,
      };
      const subscriptions = listenToPanel(deps, panel, session, createSourceView(document, page, cursor));
      panel.onDidDispose(() => {
        session.sync.dispose();
        while (subscriptions.length) { subscriptions.pop()?.dispose(); }
        authorities.release(document);
      });
      panel.webview.html = await sourceEditorHtml(panel.webview, extensionUri);
    },
  };
}
