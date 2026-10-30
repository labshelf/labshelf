// Mounts the core source editor in document mode over the webview messaging API (entry of dist/sourceEditor/sourceEditor.js); the extension host answers in writing/sourceEditor/provider.ts.
import "@labshelf/core/styles/tokens.css";
import "@labshelf/core/styles/vscodeHost.css";
import "@labshelf/core/styles/base.css";
import "./sourceEditor.css";
import { findElement } from "@labshelf/core/dom";
import { mountSourceEditor, type SourceEditorDeps } from "@labshelf/core/sourceEditor";
import { parseSourceEditorInbound, type ILogger, type SourceEditorInbound, type SourceEditorOutbound } from "@labshelf/core";
import { createWebviewTransport } from "../../../webview/index.js";

type SourceDocument = NonNullable<SourceEditorDeps["document"]>;
type DocumentListener = Parameters<SourceDocument["subscribe"]>[0];
type Init = Extract<SourceEditorInbound, { type: "init" }>;
type Request = Extract<SourceEditorOutbound, { type: "request" }>;

const NOT_AVAILABLE = "not available";

const transport = createWebviewTransport<SourceEditorOutbound, object>(acquireVsCodeApi());
const post = (message: SourceEditorOutbound): void => transport.post(message);

const logger: ILogger = {
  log: async (level, module, message, context) => {
    const write = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.info;
    write(`[${module}] ${message}`, context ?? "");
  },
  error: async (module, error, context) => { console.error(`[${module}]`, error, context ?? ""); },
};

// ---- Requests to the host

let nextRequestId = 1;
const pendingRequests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

function request(method: Request["method"], params: Record<string, unknown>): Promise<unknown> {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    post({ type: "request", id, method, params });
  });
}

function settleRequest(response: Extract<SourceEditorInbound, { type: "response" }>): void {
  const pending = pendingRequests.get(response.id);
  if (!pending) { return; }
  pendingRequests.delete(response.id);
  if (response.ok) { pending.resolve(response.value); } else { pending.reject(new Error(response.error)); }
}

const files: SourceEditorDeps["files"] = {
  async list() {
    const value = await request("listFiles", {});
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  },
  async read(path) {
    const value = await request("readFile", { path });
    if (typeof value !== "string") { throw new Error(`readFile answered no text for ${path}`); }
    return value;
  },
  // Document mode only: the host saves the file through its TextDocument.
  write: async () => { throw new Error(NOT_AVAILABLE); },
};

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
    projectId: init.projectId, path: init.path, files, papers: async () => [], helper: undefined,
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
    if (message.type === "response") { settleRequest(message); }
    else if (message.type === "init") { deliver ??= mount(message, card); }
    else if (message.type === "updates" || message.type === "resync" || message.type === "dirty") { deliver?.(message); }
  });
  post({ type: "ready" });
}

start();
