// Gets page-1 text of a staged PDF from the background: through an offscreen document in Chrome, in place in Firefox.
import { bx } from "../platform";
import { firstPageText } from "./firstPageText";
import type { FirstPageTextReply, FirstPageTextRequest } from "./offscreenRequest";

const OFFSCREEN_URL = "pdfText/offscreen.html";

interface OffscreenApi {
  createDocument(params: { url: string; reasons: string[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
  hasDocument?(): Promise<boolean>;
}

// PLATFORM: Chrome's service worker has no DOM and cannot start pdf.js's worker; Firefox's event page can.
function offscreenApi(): OffscreenApi | undefined {
  return (globalThis as { chrome?: { offscreen?: OffscreenApi } }).chrome?.offscreen;
}

// INVARIANT: one offscreen document at a time; extractions queue so one never closes the document under another.
let queue: Promise<unknown> = Promise.resolve();

async function viaOffscreen(api: OffscreenApi, id: string): Promise<string> {
  if (!(await api.hasDocument?.())) {
    await api.createDocument({ url: OFFSCREEN_URL, reasons: ["WORKERS"], justification: "Read the title on page 1 of a PDF the user downloaded or opened." });
  }
  try {
    const request: FirstPageTextRequest = { type: "offscreen.firstPageText", id };
    const reply = (await bx.runtime.sendMessage(request)) as FirstPageTextReply | undefined;
    if (!reply) throw new Error("The offscreen document did not answer.");
    if (!reply.ok) throw new Error(reply.error);
    return reply.text;
  } finally {
    await api.closeDocument();
  }
}

/** @param id the key the bytes are staged under, for the offscreen document to read them by */
export function readFirstPageText(id: string, bytes: Uint8Array): Promise<string> {
  const api = offscreenApi();
  if (!api) return firstPageText(bytes);
  const run = queue.then(() => viaOffscreen(api, id));
  queue = run.catch(() => undefined);
  return run;
}
