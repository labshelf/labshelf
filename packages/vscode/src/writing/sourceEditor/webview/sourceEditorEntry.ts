// Mounts the core source editor in document mode over the webview messaging API (entry of dist/sourceEditor/sourceEditor.js); the extension host answers in writing/sourceEditor/provider.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "./sourceEditor.css";
import { createPeerCursors, findElement, type PeerCursor, type PeerCursorSource } from "@labshelf/core/dom";
import { createSelectionListener, mountSourceEditor, showInOpenEditor, type SourceEditorDeps } from "@labshelf/core/sourceEditor";
import { parseSourceEditorInbound, type ILogger, type SourceEditorInbound, type WrapKind, type SourceEditorOutbound } from "@labshelf/core";
import { createWebviewTransport } from "../../../webview/index.js";
import { createHostPorts } from "./hostPorts.js";

type SourceDocument = NonNullable<SourceEditorDeps["document"]>;
type DocumentListener = Parameters<SourceDocument["subscribe"]>[0];
type Init = Extract<SourceEditorInbound, { type: "init" }>;

const transport = createWebviewTransport<SourceEditorOutbound, object>(acquireVsCodeApi());
const post = (message: SourceEditorOutbound): void => transport.post(message);

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

function mount(init: Init, card: HTMLElement): (message: DocumentMessage) => void {
  const host = createHostDocument(init);
  void mountSourceEditor(card, {
    projectId: init.projectId, path: init.path, helper: undefined,
    files: ports.files, papers: ports.papers, notes: ports.notes, noteLinks: ports.noteLinks,
    openNotes: ports.openNotes, openTab: ports.openTab, problems: ports.problems,
    comments: ports.comments,
    extensions: [
      createPeerCursors(peerStore),
      createSelectionListener(({ anchor, head, line }) => post({ type: "selection", anchor, head, line })),
    ],
    readOnly: init.readOnly, document: host.document, logger,
    // The tab shows the TextDocument's dirty state; the card only mirrors it.
    onDirty: (dirty) => { card.dataset.dirty = String(dirty); },
  }).then(commands.attach).catch((error: unknown) => logger.error("sourceEditor.webview", error, { action: "mount" }));
  return host.deliver;
}

function start(): void {
  const card = document.createElement("div");
  card.className = "ls-card source-editor-card";
  findElement("root").append(card);
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
    else if (message.type === "peers") { peerStore.set(message.peers); }
    else if (message.type === "reveal") { if (init) { showInOpenEditor(init.projectId, init.path, Math.max(0, message.line - 1)); } }
    else if (message.type === "init") { init = message; deliver ??= mount(message, card); }
    else if (message.type === "updates" || message.type === "resync" || message.type === "dirty") { deliver?.(message); }
  });
  post({ type: "ready" });
}

start();
