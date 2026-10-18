// Forwards page messages and document edits to a project's server, refusing what the helper does not allow.
// CONTRACT: documents/contracts/helper.md#messages
import type { ILogger } from "../../../../../ports/index.js";
import { PROTOCOL_VERSION } from "../../../index.js";
import type { HelperSend } from "../../dispatch/index.js";
import { fileUriOf, pageUrisToFiles, rootInitialize, UriRefusedError } from "../uriMapping.js";
import { MODULE, type Server } from "./server.js";

export const REFUSED_COMMAND = "workspace/executeCommand";
// The page's settings could move Tinymist's root or add compiler arguments.
const REFUSED_CONFIGURATION = "workspace/didChangeConfiguration";
// JSON-RPC "invalid request": the helper refuses the call, the server never sees it.
const INVALID_REQUEST = -32600;

export function refuse(logger: ILogger, send: HelperSend, projectId: string, payload: Record<string, unknown>, reason: string): void {
  void logger.log("WARN", MODULE, "Page message refused", { projectId, method: payload.method, reason });
  // A refused request still gets its answer, or the page's client would wait for it.
  if (payload.id !== undefined && payload.method !== undefined) {
    send({ v: PROTOCOL_VERSION, type: "lsp", projectId, payload: { jsonrpc: "2.0", id: payload.id, error: { code: INVALID_REQUEST, message: reason } } });
  }
}

function trackDocuments(server: Server, message: Record<string, unknown>): void {
  const uri = ((message.params as { textDocument?: { uri?: unknown } } | undefined)?.textDocument)?.uri;
  if (typeof uri !== "string") { return; }
  if (message.method === "textDocument/didOpen") { server.opened.add(uri); }
  if (message.method === "textDocument/didClose") { server.opened.delete(uri); }
}

/** Maps the page message onto the working copy and writes it to the server, or refuses it. */
export function writePageMessage(logger: ILogger, server: Server, send: HelperSend, projectId: string, payload: Record<string, unknown>): void {
  if (payload.method === REFUSED_CONFIGURATION) { return refuse(logger, send, projectId, payload, `${REFUSED_CONFIGURATION} is not available`); }
  let message: Record<string, unknown>;
  try {
    message = rootInitialize(pageUrisToFiles(payload, server.rootDir) as Record<string, unknown>, server.rootDir);
  } catch (error) {
    if (!(error instanceof UriRefusedError)) { throw error; }
    return refuse(logger, send, projectId, payload, error.message);
  }
  trackDocuments(server, message);
  server.process.write(message);
}

/** Tells the server an open document changed; closed documents are not sent. */
export async function writeDocumentChange(server: Server, file: string, version: number, textOf: (file: string) => Promise<string>): Promise<void> {
  const uri = fileUriOf(server.rootDir, file);
  if (!server.opened.has(uri)) { return; }
  const text = await textOf(file);
  server.process.write({
    jsonrpc: "2.0", method: "textDocument/didChange",
    params: { textDocument: { uri, version }, contentChanges: [{ text }] },
  });
}
