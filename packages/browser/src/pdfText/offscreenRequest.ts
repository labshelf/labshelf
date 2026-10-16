// Declares the one request the background sends the offscreen document, kept out of RuntimeMessage like a broadcast.

/** Asks for page-1 text of the PDF staged under `id`; the bytes stay in IndexedDB and never cross messaging. */
export interface FirstPageTextRequest {
  type: "offscreen.firstPageText";
  id: string;
}

export type FirstPageTextReply = { ok: true; text: string } | { ok: false; error: string };

export function isFirstPageTextRequest(msg: unknown): msg is FirstPageTextRequest {
  return (msg as FirstPageTextRequest | undefined)?.type === "offscreen.firstPageText";
}
