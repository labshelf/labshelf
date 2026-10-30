// Mounts the core source editor in document mode over the webview messaging API (entry of dist/sourceEditor/sourceEditor.js); the extension host answers in writing/sourceEditor/provider.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "./sourceEditor.css";
import { findElement } from "@labshelf/core/dom";
import { mountSourceEditor, type SourceEditorDeps } from "@labshelf/core/sourceEditor";
import { parseSourceEditorInbound, type ILogger, type SourceEditorInbound, type SourceEditorOutbound } from "@labshelf/core";
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

// ---- Mount

function mount(init: Init, card: HTMLElement): (message: DocumentMessage) => void {
  const host = createHostDocument(init);
  void mountSourceEditor(card, {
    projectId: init.projectId, path: init.path, helper: undefined,
    files: ports.files, papers: ports.papers, notes: ports.notes, noteLinks: ports.noteLinks,
    openNotes: ports.openNotes, openTab: ports.openTab, problems: ports.problems,
    readOnly: init.readOnly, document: host.document, logger,
    // The tab shows the TextDocument's dirty state; the card only mirrors it.
    onDirty: (dirty) => { card.dataset.dirty = String(dirty); },
  }).catch((error: unknown) => logger.error("sourceEditor.webview", error, { action: "mount" }));
  return host.deliver;
}

function start(): void {
  const card = document.createElement("div");
  card.className = "ls-card source-editor-card";
  findElement("root").append(card);
  // The host sends init first after ready; document messages before it are already part of it.
  let deliver: ((message: DocumentMessage) => void) | undefined;
  transport.subscribe((raw) => {
    const message = parseSourceEditorInbound(raw);
    if (!message) { return; }
    if (message.type === "response") { ports.settle(message); }
    else if (message.type === "problems") { ports.deliverProblems(message); }
    else if (message.type === "init") { deliver ??= mount(message, card); }
    else if (message.type === "updates" || message.type === "resync" || message.type === "dirty") { deliver?.(message); }
  });
  post({ type: "ready" });
}

start();
