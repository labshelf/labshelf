// Mounts the core source editor in document mode over the webview messaging API (entry of dist/sourceEditor/sourceEditor.js); the extension host answers in writing/sourceEditor/provider.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/code-themes.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "../../webview/index.js";
import "@labshelf/core/styles/source-editor-toolbar.css";
import "@labshelf/core/styles/project-search.css";
import "@labshelf/core/styles/qmd-drawing.css";
import "./sourceEditor.css";
import { createPeerCursors, findElement, mountFloatingSearch, type FloatingSearch, type IconName, type PeerCursor, type PeerCursorSource } from "@labshelf/core/dom";
import { createSelectionListener, mountSourceEditor, renderSourceToolbar, reviewModeDropdown, runTableDialog, showInOpenEditor, type ReviewMode, type SourceEditorDeps, type SourceToolbarButton } from "@labshelf/core/sourceEditor";
import { createFilledTableSnippet, parseSourceEditorInbound, type HostToSearch, type ILogger, type SearchTransport, type SourceEditorAction, type SourceEditorInbound, type WrapKind, type SourceEditorOutbound } from "@labshelf/core";
import { createWebviewTransport } from "../../../webview/index.js";
import { createHostPorts } from "./hostPorts.js";

type SourceDocument = NonNullable<SourceEditorDeps["document"]>;
type DocumentListener = Parameters<SourceDocument["subscribe"]>[0];
type Init = Extract<SourceEditorInbound, { type: "init" }>;

const transport = createWebviewTransport<SourceEditorOutbound, object>(acquireVsCodeApi());
const post = (message: SourceEditorOutbound): void => transport.post(message);

/** The file's language, from its extension in init; the table is written in it. */
let language: "latex" | "typst" = "latex";

async function insertTable(): Promise<void> {
  const table = await runTableDialog();
  if (table) { mountedEditor?.insertSnippet(createFilledTableSnippet(language, table)); }
}

/** Whether the toolbar shows the review dropdown: the host offers review for the file. */
let toolbarReview = false;

/** Whether the project's PDF preview is open, as the host reports it; the eye button shows it. */
let previewOpen = false;

/** The project search floating over the editor; undefined until the page starts. */
let floatingSearch: FloatingSearch | undefined;

/** The floating search's channel: its messages ride the editor's own in a "projectSearch" envelope, which the host answers with a search session. */
function searchChannel(): SearchTransport {
  return {
    post: (message) => transport.post({ type: "projectSearch", message } as unknown as SourceEditorOutbound),
    subscribe: (handler) => transport.subscribe((raw) => {
      const envelope = raw as { type?: unknown; message?: unknown };
      if (envelope.type === "projectSearch") { handler(envelope.message as HostToSearch); }
    }),
  };
}

const logger: ILogger = {
  log: async (level, module, message, context) => {
    const write = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.info;
    write(`[${module}] ${message}`, context ?? "");
  },
  error: async (module, error, context) => { console.error(`[${module}]`, error, context ?? ""); },
};

// The editor's papers, notes, files and problems are requests to the host.
const ports = createHostPorts(post);

// ---- The host's document

type DocumentMessage = Extract<SourceEditorInbound, { type: "updates" | "resync" | "dirty" }>;

/** The document the editor edits: messages that come before the editor subscribes are kept and replayed, so no update is missed while it mounts. */
function createHostDocument(init: Init): { document: SourceDocument; deliver(message: DocumentMessage): void } {
  const listeners = new Set<DocumentListener>();
  const early: DocumentMessage[] = [];
  const dispatch = (listener: DocumentListener, message: DocumentMessage): void => {
    if (message.type === "updates") { listener.updates(message.version, message.updates); }
    else if (message.type === "resync") { listener.resync(message.text, message.version); }
    else { listener.dirty(message.dirty); }
  };
  const document: SourceDocument = {
    text: init.text, lineBreak: init.lineBreak, version: init.version, dirty: init.dirty,
    push: (version, updates) => post({ type: "push", version, updates }),
    subscribe(listener) {
      listeners.add(listener);
      for (const message of early.splice(0)) { dispatch(listener, message); }
      return () => { listeners.delete(listener); };
    },
    save: () => post({ type: "save" }),
  };
  return {
    document,
    deliver(message) {
      if (listeners.size === 0) { early.push(message); return; }
      for (const listener of listeners) { dispatch(listener, message); }
    },
  };
}

// ---- The peers

/** The peers the host last posted; the editor draws them and redraws when a new list arrives. */
function createPeerStore(): PeerCursorSource & { set(peers: readonly PeerCursor[]): void } {
  let peers: readonly PeerCursor[] = [];
  const listeners = new Set<() => void>();
  return {
    peers: () => peers,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(next) { peers = next; for (const listener of [...listeners]) { listener(); } },
  };
}

const peerStore = createPeerStore();

// ---- Mount

type MountedEditor = Awaited<ReturnType<typeof mountSourceEditor>>;

type EditorCommand =
  | { kind: "insertText"; text: string }
  | { kind: "insertSnippet"; snippet: string }
  | { kind: "wrap"; style: WrapKind };

/** A `{type: "command"}` message from the host (the editor title actions); anything else is undefined. */
function parseCommand(raw: unknown): EditorCommand | undefined {
  if (typeof raw !== "object" || raw === null || (raw as { type?: unknown }).type !== "command") { return undefined; }
  const command = (raw as { command?: unknown }).command;
  if (typeof command !== "object" || command === null) { return undefined; }
  const { kind, text, snippet, style } = command as Record<string, unknown>;
  if (kind === "insertText" && typeof text === "string") { return { kind, text }; }
  if (kind === "insertSnippet" && typeof snippet === "string") { return { kind, snippet }; }
  if (kind === "wrap" && (style === "bold" || style === "italic")) { return { kind, style }; }
  return undefined;
}

/** The mounted editor, once it is; commands that arrive while it mounts wait for it. */
function createCommandRunner(): { attach(editor: MountedEditor): void; run(command: EditorCommand): void } {
  let editor: MountedEditor | undefined;
  const waiting: EditorCommand[] = [];
  const apply = (target: MountedEditor, command: EditorCommand): void => {
    if (command.kind === "insertText") { target.insertText(command.text); }
    else if (command.kind === "insertSnippet") { target.insertSnippet(command.snippet); }
    else { target.wrap(command.style); }
  };
  return {
    attach(next) { editor = next; for (const command of waiting.splice(0)) { apply(next, command); } },
    run(command) { if (editor) { apply(editor, command); } else { waiting.push(command); } },
  };
}

const commands = createCommandRunner();

// ---- Review mode

/** The mounted editor, for the dropdown to switch its mode; the toolbar is drawn before the editor mounts, so it asks for the editor when picked. */
let mountedEditor: MountedEditor | undefined;
/** The mode the host stored for the project; the dropdown shows it and the editor starts in it. */
let reviewMode: ReviewMode = "editing";
let toolbar: HTMLElement | undefined;

/** Keeps the mode and tells the host, which stores it per project; false when it is the mode already kept. */
function keepReviewMode(mode: ReviewMode): boolean {
  if (mode === reviewMode) { return false; }
  reviewMode = mode;
  post({ type: "reviewMode", mode });
  return true;
}

// ---- Toolbar

const action = (label: string, glyph: IconName, name: SourceEditorAction): SourceToolbarButton => ({ label, glyph, run: () => ports.runAction(name) });
const wrap = (label: string, glyph: IconName, style: WrapKind): SourceToolbarButton => ({ label, glyph, run: () => commands.run({ kind: "wrap", style }) });

/** The toolbar's left side: the actions that change the text itself, in groups. */
const TEXT_TOOLS: readonly (readonly SourceToolbarButton[])[] = [
  [wrap("Bold", "bold", "bold"), wrap("Italic", "italic", "italic")],
  [
    action("Insert Symbol", "symbol-operator", "insertSymbol"), // The table dialog runs here, in the editor: the size, the cells or a CSV, then the table at the cursor.
    { label: "Insert Table", glyph: "table", run: () => { void insertTable(); } },
    action("Insert Image", "file-media", "insertImage"),
    // Draws a diagram as TikZ with the notes' drawing editor, or edits the one at the cursor.
    { label: "Insert Diagram", glyph: "chart", run: () => { void mountedEditor?.editDrawing(); } },
    action("Cite from Library", "quote", "citeFromLibrary"),
  ],
];

/** The project's tools at the right side; Show PDF Preview opens the PDF beside the source, or brings it back after it was closed. */
const PROJECT_TOOLS: readonly SourceToolbarButton[] = [
  { label: "Search in Project", glyph: "search", run: () => { if (floatingSearch) { floatingSearch.toggle(); } else { ports.runAction("searchInProject"); } } },
  // An open eye while the project's PDF is open, which closes it; a closed eye opens it.
  { get label() { return previewOpen ? "Hide PDF Preview" : "Show PDF Preview"; }, get glyph() { return previewOpen ? "eye" : "eye-off"; }, run: () => ports.runAction("togglePreview") },
  action("Show Project History", "history", "showHistory"),
];

/** Share, at the toolbar's right end as in Overleaf's header. */
const SHARE: readonly SourceToolbarButton[] = [{ label: "Share", glyph: "users", primary: true, run: () => ports.runAction("shareProject") }];

/** The toolbar: the text tools at the left; the project tools, then the review dropdown where the host offers review and Share, at the right. */
function renderToolbar(withReview: boolean): HTMLElement {
  const end = withReview ? [reviewModeDropdown(() => reviewMode, (picked) => { keepReviewMode(picked); mountedEditor?.setReviewMode(picked); }), ...SHARE] : SHARE;
  return renderSourceToolbar(TEXT_TOOLS, [PROJECT_TOOLS, end]);
}

/** Draws the toolbar again, as the dropdown shows the mode the editor reports and the eye whether the PDF is open. */
function redrawToolbar(): void {
  if (!toolbar) { return; }
  const next = renderToolbar(toolbarReview);
  toolbar.replaceWith(next);
  toolbar = next;
}

function mount(init: Init, card: HTMLElement): (message: DocumentMessage) => void {
  const host = createHostDocument(init);
  const { review } = init;
  void mountSourceEditor(card, {
    projectId: init.projectId, path: init.path, helper: undefined,
    files: ports.files, papers: ports.papers, notes: ports.notes, noteLinks: ports.noteLinks,
    openNotes: ports.openNotes, openTab: ports.openTab, problems: ports.problems,
    comments: ports.comments,
    ...(review ? { review: { author: () => review.author, mode: reviewMode, suggestions: ports.suggestions, onMode: (mode: ReviewMode) => { if (keepReviewMode(mode)) { redrawToolbar(); } } } } : {}),
    extensions: [
      createPeerCursors(peerStore),
      createSelectionListener(({ anchor, head, line }) => post({ type: "selection", anchor, head, line })),
    ],
    readOnly: init.readOnly, document: host.document, logger,
    // The tab shows the TextDocument's dirty state; the card only mirrors it.
    onDirty: (dirty) => { card.dataset.dirty = String(dirty); },
  }).then((editor) => { mountedEditor = editor; commands.attach(editor); }).catch((error: unknown) => logger.error("sourceEditor.webview", error, { action: "mount" }));
  return host.deliver;
}

function start(): void {
  const card = document.createElement("div");
  card.className = "ls-card source-editor-card";
  findElement("root").append(card);
  floatingSearch = mountFloatingSearch(card, searchChannel);
  transport.subscribe((raw) => {
    const message = raw as { type?: unknown; open?: unknown };
    if (message.type !== "previewOpen" || message.open === previewOpen) { return; }
    previewOpen = message.open === true;
    redrawToolbar();
  });
  // The host sends init first after ready; document messages before it are already part of it.
  let deliver: ((message: DocumentMessage) => void) | undefined;
  let init: Init | undefined;
  transport.subscribe((raw) => {
    const command = parseCommand(raw);
    if (command) { commands.run(command); return; }
    const message = parseSourceEditorInbound(raw);
    if (!message) { return; }
    if (message.type === "response") { ports.settle(message); }
    else if (message.type === "problems") { ports.deliverProblems(message); }
    else if (message.type === "comments") { ports.deliverComments(message); }
    else if (message.type === "suggestions") { ports.deliverSuggestions(message); }
    else if (message.type === "peers") { peerStore.set(message.peers); }
    else if (message.type === "reveal") { if (init) { showInOpenEditor(init.projectId, init.path, Math.max(0, message.line - 1)); } }
    else if (message.type === "init") {
      init = message;
      // The actions are the project's (labshelf.writing.inProject), so a file outside any project has no toolbar.
      if (!deliver && message.projectId !== "") {
        reviewMode = message.review?.mode ?? "editing";
        toolbarReview = message.review !== undefined;
        language = message.path.endsWith(".typ") ? "typst" : "latex";
        toolbar = renderToolbar(toolbarReview);
        card.append(toolbar);
      }
      deliver ??= mount(message, card);
    }
    else if (message.type === "updates" || message.type === "resync" || message.type === "dirty") { deliver?.(message); }
  });
  post({ type: "ready" });
}

start();
