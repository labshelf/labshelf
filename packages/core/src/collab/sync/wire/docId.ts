// Derives the opaque id a doc travels under, so a relay that stores frames by doc never learns file paths.
import { DOC_ID_BYTES } from "./envelope.js";

// CONTRACT: documents/contracts/collaboration.md#messages
export async function deriveDocId(shareId: string, docKey: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${shareId}\0${docKey}`));
  return new Uint8Array(digest, 0, DOC_ID_BYTES);
}
