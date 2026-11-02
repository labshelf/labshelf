// Answers the socket's deck print messages: printPdf prints the payload HTML through Chromium and replies pdfPrinted (the PDF
// as payload) or printFailed; cancelPrint aborts a run by its request id.
// CONTRACT: documents/contracts/helper.md#messages
import * as os from "node:os";

import { formatError } from "../../errors/index.js";
import type { ILogger } from "../../ports/index.js";
import { parseDeckSize, type DeckSize } from "../../decks/index.js";
import { createSharedChromiumProvider, findSystemChromium, printDeckPdf } from "../../decks/node/index.js";
import { MAX_PRINT_HTML_BYTES, MAX_SOCKET_MESSAGE_BYTES, PROTOCOL_VERSION, type HelperPrintFailure } from "../helperMessages.js";
import type { HelperHandler, HelperSend } from "./helperHandlers.js";

export interface PrintHandlerDeps { print: (html: string, size: DeckSize, signal: AbortSignal) => Promise<Uint8Array | { error: "noChromium" | "failed"; message: string }> }

const SILENT: ILogger = { log: async () => undefined, error: async () => undefined };
const NO_CHROMIUM ="No Chromium-based browser was found. Install Chrome or Chromium to export PDFs.";

/** Prints through the system Chromium, else the managed one when installed; the Helper never installs it. The page size comes from the HTML's @page rule. */
async function printWithChromium(html: string, _size: DeckSize, signal: AbortSignal): ReturnType<PrintHandlerDeps["print"]> {
  const managed = async () => {
    // status() only reads the tools folder, so the provider downloads nothing and logs nothing worth keeping.
    const status = await createSharedChromiumProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger: SILENT, fetchImpl: fetch }).status();
    return status.installed ? status.executable : undefined;
  };
  const chromium = await findSystemChromium(managed);
  if (!chromium) { return { error: "noChromium", message: NO_CHROMIUM }; }
  try {
    return await printDeckPdf(html, { chromium: chromium.path, signal });
  } catch (error) {
    return { error: "failed", message: formatError(error) };
  }
}

const failed = (send: HelperSend, id: string, reason: HelperPrintFailure, message: string) => send({ v: PROTOCOL_VERSION, id, type: "printFailed", reason, message });

/** printPdf and cancelPrint over one map of running prints; `deps.print` replaces the Chromium printer. */
export function createPrintHandlers(deps?: Partial<PrintHandlerDeps>): Record<"printPdf" | "cancelPrint", HelperHandler> {
  const print = deps?.print ?? printWithChromium;
  const running = new Map<string, AbortController>();
  // INVARIANT: the controller is registered before any await, because the dispatcher runs a cancelPrint without waiting for this run.
  const printPdf: HelperHandler = async (message, send, payload) => {
    if (message.type !== "printPdf") { throw new Error(`printPdf handler received ${message.type}`); }
    const { id } = message;
    const html = payload ?? new Uint8Array();
    if (html.length > MAX_PRINT_HTML_BYTES) { failed(send, id, "limit", "The deck is too large to print through LabShelf Helper."); return; }
    const size = parseDeckSize(message.size);
    if (!size) { failed(send, id, "failed", `"${message.size}" is not a deck size.`); return; }
    const controller = new AbortController();
    running.set(id, controller);
    try {
      const result = await print(new TextDecoder().decode(html), size, controller.signal).catch((error: unknown) => ({ error: "failed" as const, message: formatError(error) }));
      if (controller.signal.aborted) { failed(send, id, "failed", "Cancelled."); return; }
      if (!(result instanceof Uint8Array)) { failed(send, id, result.error, result.message); return; }
      if (result.length > MAX_SOCKET_MESSAGE_BYTES) { failed(send, id, "limit", "The PDF is too large to send through LabShelf Helper."); return; }
      send({ v: PROTOCOL_VERSION, id, type: "pdfPrinted", bytes: result.length }, result);
    } finally {
      running.delete(id);
    }
  };
  const cancelPrint: HelperHandler = (message) => {
    if (message.type !== "cancelPrint") { throw new Error(`cancelPrint handler received ${message.type}`); }
    running.get(message.requestId)?.abort();
    return Promise.resolve();
  };
  return { printPdf, cancelPrint };
}
