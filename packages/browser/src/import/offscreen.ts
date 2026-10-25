// Answers the background's page-1 text requests in Chrome's offscreen document, where pdf.js can start its worker.
import { formatError } from "@labshelf/core";
import { bx } from "../platform";
import { readStagedPdf } from "../storage";
import { extractFirstPageText } from "./extractFirstPageText";
import { isFirstPageTextRequest, type FirstPageTextReply } from "./offscreenRequest";

async function answer(id: string): Promise<FirstPageTextReply> {
  try {
    const bytes = await readStagedPdf(id);
    if (!bytes) return { ok: false, error: `No staged PDF "${id}".` };
    return { ok: true, text: await extractFirstPageText(bytes) };
  } catch (error) {
    return { ok: false, error: formatError(error) };
  }
}

// Must return nothing for other messages: popup requests reach this page too, and a Promise would answer them.
bx.runtime.onMessage.addListener((msg: unknown) => (isFirstPageTextRequest(msg) ? answer(msg.id) : undefined));
