// The LabShelf editor for .tex and .typ files (D1): a custom text editor whose webview hosts the core source editor over the file's TextDocument, one authority per document shared by every panel on it, and the project files it may read.
import * as vscode from "vscode";

import {
  createNonce, createSourceAuthority, parseSourceEditorOutbound,
  type Annotation, type DictionaryStore, type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type SourceAuthority, type SourceEditorInbound, type SourceEditorOutbound, type SelectionPopupPrefs, type TypingHelpers,
} from "@labshelf/core";
import type { EditorPrefsHost } from "./editorPrefsHost.js";
import type { SourceFileComments, SourceFileSuggestions } from "../../collab/index.js";
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell, webviewChunksDir } from "../../ui/index.js";
import type { ActiveSource, SourceView } from "../activeSource.js";
import { deriveBuildRootPath, findOwningProject, type WritingProjects } from "../projects/index.js";
import { ProjectSearchSession } from "../search/index.js";
import { previewVisibility } from "../preview/index.js";
import { projectChatAvailability } from "../projectChat/index.js";
import { createSourceBridges, type ReviewModeStore, type SourceBridges, type SourceReviewMode } from "./bridges.js";
import { createCodeChangeFeed } from "./codeFiles.js";
import { createDeckWorkspaceBridge, currentPdfjs, isDeckSource, type DeckWorkspaceBridge } from "./deckWorkspaceHost.js";
import { describePdfjsAssets, pdfjsResourceRoots } from "./pdfjsAssets.js";
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
  /** A paper's highlights, for citing one and the cite hover. */
  highlightsOf?(paperId: string): Promise<Annotation[]>;
  /** Opens a paper in the reader, at a page when given. */
  openPaper?(paperId: string, page?: number): void;
  /** The comment manager's port, read when a panel opens; absent where comments do not run (the web). */
  comments?(): SourceFileComments | undefined;
  /** The suggestion store's port, read when a panel opens; absent where it does not run (the web). */
  suggestions?(): SourceFileSuggestions | undefined;
  /** The machine-local spelling dictionaries and the user's words; without it the page proofs nothing. */
  dictionaries?: DictionaryStore;
  /** The typing helpers' switches, stored in the library's editor-prefs.json; without it the panels keep them for the session only. */
  editorPrefs?: EditorPrefsHost;
  /** Where each project's review mode is kept (the workspace state); without it no panel offers review. */
  state?: Pick<vscode.Memento, "get" | "update">;
}

/** A project's review mode is kept under this key; Editing until the user picks Reviewing. */
const reviewModeKey = (projectId: string): string => `labshelf.reviewMode.${projectId}`;

/** The stored mode of a project; a panel reads it when it opens, so another panel's change shows after reopening. */
function createReviewModeStore(state: NonNullable<SourceEditorProviderDeps["state"]>, projectId: string, logger: ILogger): ReviewModeStore {
  return {
    get: () => state.get<SourceReviewMode>(reviewModeKey(projectId)) === "reviewing" ? "reviewing" : "editing",
    set: (mode) => { void Promise.resolve(state.update(reviewModeKey(projectId), mode)).catch((error: unknown) => logger.error("writing/sourceEditor", error, { action: "storeReviewMode", projectId })); },
  };
}

type Request = Extract<SourceEditorOutbound, { type: "request" }>;
type Response = Extract<SourceEditorInbound, { type: "response" }>;

/** <extension>/dist/sourceEditor, for localResourceRoots. */
function bundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "sourceEditor");
}

/** Every page may show PDF pages: a talk's or poster's workspace, and Cite from Library's popup and the cite hover in any file. */
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
    images: "qmd",
    pdfPages: true,
    wasm: true,
  });
}

function lineBreakOf(document: vscode.TextDocument): "\n" | "\r\n" {
  return document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n";
}

/** The first message a panel gets: the file, its project and the authority's text, LF inside the editor. */
function initMessage(
  document: vscode.TextDocument, authority: SourceAuthority, projects: SourceEditorProviderDeps["projects"], review: ReturnType<SourceBridges["review"]>, typing: TypingHelpers | undefined,
  selectionPopup?: SelectionPopupPrefs,
): SourceEditorInbound {
  const file = document.uri.fsPath;
  const project = document.uri.scheme === "file" ? findOwningProject(projects, file) : undefined;
  const path = project ? deriveBuildRootPath(projects.paths, project, file) : projects.paths.basename(file);
  return {
    type: "init", path, projectId: project?.settings.id ?? "", language: file.endsWith(".typ") ? "typst" : "latex",
    text: authority.text().replace(/\r\n/g, "\n"), lineBreak: lineBreakOf(document), version: authority.version,
    readOnly: false, dirty: document.isDirty,
    mathPreview: vscode.workspace.getConfiguration("labshelf.writing").get<boolean>("mathPreview", true),
    spelling: vscode.workspace.getConfiguration("labshelf.writing").get<boolean>("spelling", true),
    ...(review && { review }), ...(typing && { typing }), ...(selectionPopup && { selectionPopup }),
  };
}

/** Answers a request of the page from the workspace bridge, else the bridges; a rejection is its error response. */
async function answerRequest(request: Request, bridges: SourceBridges, deck: DeckWorkspaceBridge | undefined): Promise<Response> {
  const { id, method, params } = request;
  try {
    return { type: "response", id, ok: true, value: await (deck?.handle(method, params) ?? bridges.handle(method, params)) };
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
      citeFromLibrary: () => page.post({ type: "command", command: { kind: "citeFromLibrary" } }),
    },
  };
}

/** The bridges of the file's owning project as the projects list it now. */
function createPanelBridges(deps: SourceEditorProviderDeps, document: vscode.TextDocument, webview: vscode.Webview): SourceBridges {
  const project = document.uri.scheme === "file" ? findOwningProject(deps.projects, document.uri.fsPath) : undefined;
  return createSourceBridges({
    citations: { store: { fs: deps.projects.fs, paths: deps.projects.paths, logger: deps.logger }, pdfAssets: () => describePdfjsAssets(webview, currentPdfjs()) },
    comments: deps.comments?.(),
    // A file in no project has no mode to keep, so it offers no review.
    suggestions: deps.suggestions?.(), reviewMode: project && deps.state ? createReviewModeStore(deps.state, project.settings.id, deps.logger) : undefined,
    uri: document.uri, projectRoot: project ? vscode.Uri.file(project.folder) : undefined, library: deps.library,
    notes: { ...(project ? deps.noteSource(project) : NO_NOTES), read: (paperId) => deps.paperNotes.read(paperId) },
    openNotes: deps.openNotes, ...(deps.highlightsOf && { highlightsOf: deps.highlightsOf }), ...(deps.openPaper && { openPaper: deps.openPaper }), dictionaries: deps.dictionaries, editorPrefs: deps.editorPrefs, logger: deps.logger,
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
  /** New bridges for the owning project as listed now; a panel restored with the window resolves before the projects are listed. */
  createBridges(): SourceBridges;
  sync: ReturnType<typeof createDocumentSync>;
  focus: vscode.EventEmitter<boolean>;
  cursor: { line: number };
  peers: PeerMemory;
  presence: ReturnType<typeof createSourcePresence> | undefined;
  /** The file's comment threads, followed from the page's first ready until the panel closes. */
  commentWatch: { current?: vscode.Disposable };
  /** The file's tracked changes, followed the same way. */
  suggestionWatch: { current?: vscode.Disposable | undefined };
  /** The talk and poster workspace's requests and build state; undefined for any other file. */
  deck: DeckWorkspaceBridge | undefined;
  deckWatch: { current?: vscode.Disposable | undefined };
  /** The typing helpers shared by both apps; undefined where there is none. */
  editorPrefs: EditorPrefsHost | undefined;
  /** The page's subscription to changes of the typing helpers. */
  typingWatch: { current?: vscode.Disposable | undefined };
}

/** The page is listening: send it the file, its problems, comments, the peers and any reveal that waited. */
async function sendReady(session: PanelSession): Promise<void> {
  // Read before the page becomes ready, so the init carries the stored switches and no change slips between the read and the subscription below.
  const typing = await session.editorPrefs?.typing();
  const selectionPopup = await session.editorPrefs?.selectionPopup();
  session.bridges = session.createBridges();
  const { page, bridges, commentWatch, suggestionWatch } = session;
  page.becomeReady();
  page.post(initMessage(session.document, session.authority, session.projects, bridges.review(), typing, selectionPopup));
  session.typingWatch.current?.dispose();
  const unsubscribe = session.editorPrefs?.onChange((next) => page.post({ type: "typing", typing: next }));
  const unsubscribePopup = session.editorPrefs?.onSelectionPopupChange((next) => page.post({ type: "selectionPopup", selectionPopup: next }));
  session.typingWatch.current = unsubscribe && { dispose: () => { unsubscribe(); unsubscribePopup?.(); } };
  page.post(bridges.problems());
  commentWatch.current?.dispose();
  commentWatch.current = bridges.watchComments(page.post);
  suggestionWatch.current?.dispose();
  suggestionWatch.current = bridges.review() ? bridges.watchSuggestions(page.post) : undefined;
  if (session.peers.last) { page.post({ type: "peers", peers: session.peers.last }); }
  session.deckWatch.current?.dispose();
  session.deckWatch.current = session.deck?.watch(page.post);
  page.flushReveal();
}

function handlePageMessage(raw: unknown, session: PanelSession): void {
  const message = parseSourceEditorOutbound(raw);
  if (!message) { return; }
  if (message.type === "ready") {
    void sendReady(session);
  } else if (message.type === "focus") {
    session.focus.fire(message.focused);
  } else if (message.type === "selection") {
    session.cursor.line = message.line;
    session.presence?.selection(message);
  } else if (message.type === "request") {
    void answerRequest(message, session.bridges, session.deck).then(session.page.post);
  } else if (message.type === "addSuggestions" || message.type === "removeSuggestions" || message.type === "reviewMode") {
    void session.bridges.receiveReview(message);
  } else {
    void session.sync.receive(message);
  }
}

const isSearchEnvelope = (raw: unknown): raw is { type: "projectSearch"; message: unknown } =>
  typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "projectSearch";

/** What the panel listens to; the panel's disposal releases them all. */
function listenToPanel(deps: SourceEditorProviderDeps, panel: vscode.WebviewPanel, session: PanelSession, view: SourceView): vscode.Disposable[] {
  const { document, focus, page } = session;
  const registration = deps.activeSource.register(view, focus.event);
  const previewFolder = document.uri.scheme === "file" ? findOwningProject(deps.projects, document.uri.fsPath)?.folder : undefined;
  const postPreviewOpen = (): void => {
    if (previewFolder !== undefined) { void panel.webview.postMessage({ type: "previewOpen", open: previewVisibility.isOpen(previewFolder) }); }
  };
  // The chat icon shows only for a project with a chat, which is a shared one (D2).
  const postProjectChat = (): void => {
    void panel.webview.postMessage({ type: "projectChat", available: previewFolder !== undefined && projectChatAvailability.isAvailable(previewFolder) });
  };
  // The floating search covers this file's project, with the same searches, opens and replacements as the bottom panel.
  const search = new ProjectSearchSession({ projects: deps.projects, logger: () => deps.logger },
    (message) => void panel.webview.postMessage({ type: "projectSearch", message }), () => (document.uri.scheme === "file" ? document.uri.fsPath : undefined));
  // A panel that opens or is restored in front reports no view state change, so it would never become the current source.
  if (panel.active) { focus.fire(true); }
  return [
    focus,
    { dispose: () => session.commentWatch.current?.dispose() },
    { dispose: () => session.suggestionWatch.current?.dispose() },
    { dispose: () => session.deckWatch.current?.dispose() },
    { dispose: () => session.typingWatch.current?.dispose() },
    { dispose: () => session.presence?.dispose() },
    registration,
    panel.onDidChangeViewState(() => focus.fire(panel.active)),
    // The build's and other extensions' diagnostics of this file, whenever any collection changes them.
    vscode.languages.onDidChangeDiagnostics((event) => {
      const key = document.uri.toString();
      if (event.uris.some((changed) => changed.toString() === key)) { page.post(session.bridges.problems()); }
    }),
    search,
    previewVisibility.onDidChange((changed) => { if (changed === previewFolder) { postPreviewOpen(); } }),
    projectChatAvailability.onDidChange(postProjectChat),
    // The floating search's messages travel in a "projectSearch" envelope beside the editor's own.
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (isSearchEnvelope(raw)) { void search.handle(raw.message); return; }
      // A page that starts or reloads learns whether the PDF is open, for its eye button.
      if ((raw as { type?: unknown } | null)?.type === "ready") { postPreviewOpen(); postProjectChat(); }
      return handlePageMessage(raw, session);
    }),
  ];
}

export function createSourceEditorProvider(deps: SourceEditorProviderDeps): vscode.CustomTextEditorProvider {
  const authorities = createAuthorities();
  const codeChanges = createCodeChangeFeed();
  return {
    async resolveCustomTextEditor(document, panel) {
      const { extensionUri, logger } = deps;
      const deck = isDeckSource(document);
      panel.webview.options = { enableScripts: true, localResourceRoots: [bundleDirectory(extensionUri), webviewChunksDir(extensionUri), ...pdfjsResourceRoots(currentPdfjs())] };
      const authority = authorities.acquire(document);
      const project = document.uri.scheme === "file" ? findOwningProject(deps.projects, document.uri.fsPath) : undefined;
      const page = createPage(panel);
      const peers: PeerMemory = {};
      const cursor = { line: 1 };
      const session: PanelSession = {
        document, authority, projects: deps.projects, page, cursor, peers, commentWatch: {}, suggestionWatch: {},
        deck: deck ? createDeckWorkspaceBridge(document, logger) : undefined, deckWatch: {},
        editorPrefs: deps.editorPrefs, typingWatch: {},
        bridges: createPanelBridges(deps, document, panel.webview), createBridges: () => createPanelBridges(deps, document, panel.webview),
        sync: createDocumentSync({ document, authority, applyEdit: (edit) => vscode.workspace.applyEdit(edit), post: page.post, logger }),
        focus: new vscode.EventEmitter<boolean>(),
        presence: project ? openPresence(document, page.post, peers) : undefined,
      };
      const subscriptions = listenToPanel(deps, panel, session, createSourceView(document, page, cursor));
      // A saved or rewritten code file redraws the marks of the listings copied from it.
      subscriptions.push(codeChanges.subscribe(() => page.post({ type: "codeChanged" })));
      panel.onDidDispose(() => {
        session.sync.dispose();
        while (subscriptions.length) { subscriptions.pop()?.dispose(); }
        authorities.release(document);
      });
      panel.webview.html = await sourceEditorHtml(panel.webview, extensionUri);
    },
  };
}
