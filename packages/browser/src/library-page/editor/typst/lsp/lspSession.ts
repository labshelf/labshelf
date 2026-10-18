// Shares one Tinymist session per project among its open Typst editors: the handshake on each opening, didOpen and didClose.
// CONTRACT: documents/contracts/helper.md#page-to-helper-socket
import type { ILogger } from "@labshelf/core";
import type { HelperLspChannel } from "../../../helperProject";
import { createLspClient, type LspClient } from "./lspClient";
import { pageUri, type LspPosition, type LspRange } from "./lspPositions";

export interface LspDiagnostic { range: LspRange; severity?: number; message: string; source?: string }

export interface TypstDocumentOptions {
  projectId: string;
  path: string;
  channel: HelperLspChannel;
  logger: ILogger;
  text(): string;
  onDiagnostics(diagnostics: readonly LspDiagnostic[]): void;
}

export interface TypstDocument {
  /** Asks a position request about this document; null while no server runs or when the request fails or is cancelled. */
  ask<T>(method: string, position: LspPosition, signal?: AbortSignal): Promise<T | null>;
  close(): void;
}

// INVARIANT: one file may be open in two editors (two groups); the server sees it opened once.
interface Session { docs: Set<TypstDocumentOptions>; client?: LspClient; ready?: Promise<boolean>; initialized: boolean; stopOpen(): void }

const MODULE = "editor.typst.lspSession";
const sessions = new Map<string, Session>();
const sharesPath = (session: Session, doc: TypstDocumentOptions): boolean =>
  [...session.docs].some((other) => other !== doc && other.path === doc.path);

// Text sync is the helper's: every `edit` reaches the server as didChange, so the page sends none.
const CAPABILITIES = {
  general: { positionEncodings: ["utf-16"] },
  textDocument: {
    synchronization: { dynamicRegistration: false },
    completion: { completionItem: { snippetSupport: true, documentationFormat: ["plaintext", "markdown"] } },
    hover: { contentFormat: ["plaintext", "markdown"] },
    definition: { linkSupport: true },
    publishDiagnostics: {},
  },
};

function didOpen(client: LspClient, doc: TypstDocumentOptions): void {
  client.notify("textDocument/didOpen", { textDocument: { uri: pageUri(doc.path), languageId: "typst", version: 0, text: doc.text() } });
}

function start(session: Session, options: TypstDocumentOptions): void {
  const { channel, logger, projectId } = options;
  session.client?.dispose();
  const client = createLspClient(channel, logger, projectId);
  session.client = client;
  session.initialized = false;
  client.onNotification("textDocument/publishDiagnostics", (params) => {
    const { uri, diagnostics } = params as { uri: string; diagnostics: LspDiagnostic[] };
    for (const doc of session.docs) if (pageUri(doc.path) === uri) doc.onDiagnostics(diagnostics);
  });
  session.ready = client.request("initialize", { processId: null, rootUri: null, capabilities: CAPABILITIES })
    .then(() => {
      if (session.client !== client) return false;
      client.notify("initialized", {});
      session.initialized = true;
      const opened = new Set<string>();
      for (const doc of session.docs) if (!opened.has(doc.path)) { opened.add(doc.path); didOpen(client, doc); }
      void logger.log("INFO", MODULE, "Typst language server initialized", { projectId, documents: session.docs.size });
      return true;
    })
    .catch(async (error: unknown) => { await logger.error(MODULE, error, { action: "initialize", projectId }); return false; });
}

function sessionFor(options: TypstDocumentOptions): Session {
  const existing = sessions.get(options.projectId);
  if (existing) return existing;
  const session: Session = { docs: new Set(), initialized: false, stopOpen: () => undefined };
  sessions.set(options.projectId, session);
  session.stopOpen = options.channel.onOpen(() => start(session, options));
  return session;
}

function release(session: Session, options: TypstDocumentOptions): void {
  if (!session.docs.has(options)) return;
  const shared = sharesPath(session, options);
  session.docs.delete(options);
  if (session.initialized && !shared) session.client?.notify("textDocument/didClose", { textDocument: { uri: pageUri(options.path) } });
  if (session.docs.size > 0) return;
  session.stopOpen();
  session.client?.dispose();
  sessions.delete(options.projectId);
}

export function openTypstDocument(options: TypstDocumentOptions): TypstDocument {
  const session = sessionFor(options);
  session.docs.add(options);
  if (session.initialized && session.client && !sharesPath(session, options)) didOpen(session.client, options);
  const textDocument = { uri: pageUri(options.path) };
  return {
    async ask<T>(method: string, position: LspPosition, signal?: AbortSignal): Promise<T | null> {
      const client = session.client;
      if (!client || !(await session.ready) || session.client !== client) return null;
      try {
        return await client.request<T>(method, { textDocument, position }, signal);
      } catch (error) {
        if (!signal?.aborted) await options.logger.error(MODULE, error, { action: method, projectId: options.projectId, path: options.path });
        return null;
      }
    },
    close: () => release(session, options),
  };
}
