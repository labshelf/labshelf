// Copies the papers of a pasted or opened share link into the library, as a typed outcome the host shows.
import { parseShareLink } from "../shareLink.js";
import { importSharedPapers, type ImportSharedPapersOptions, type SharedImportSummary } from "../importSharedPapers.js";
import { openShare, type OpenShareError } from "../openShare.js";
import type { ShareReader } from "../shareBackend.js";

export interface ImportShareLinkOptions extends Omit<ImportSharedPapersOptions, "share"> {
  text: string;
  readerFor: (relayUrl: string) => ShareReader;
}

/** `refused` carries the parse error of a link that does not parse; `withAnnotations` says the share held annotations. */
export type ImportShareLinkResult =
  | { status: "refused"; error: string }
  | { status: "openFailed"; error: OpenShareError }
  | { status: "imported"; summary: SharedImportSummary; withAnnotations: boolean };

const MODULE = "share";

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
/** Rejects only when writing the papers fails; a bad, revoked or unreachable link is a typed result. */
export async function importShareLink(options: ImportShareLinkOptions): Promise<ImportShareLinkResult> {
  const { text, ctx, readerFor } = options;
  const parsed = parseShareLink(text);
  if (!parsed.ok) {
    await ctx.logger.log("WARN", MODULE, "Refused a share link that does not parse", { error: parsed.error });
    return { status: "refused", error: parsed.error };
  }
  const opened = await openShare(text, readerFor);
  if (!opened.ok) {
    const context = { shareId: parsed.link.shareId, relayUrl: parsed.link.relayUrl, error: opened.error, detail: opened.detail };
    await ctx.logger.log("WARN", MODULE, "Could not open a share link", context);
    return { status: "openFailed", error: opened.error };
  }
  let summary: SharedImportSummary;
  try {
    summary = await importSharedPapers({ ...options, share: opened.share });
  } catch (error) {
    await ctx.logger.error(MODULE, error, { action: "import the shared papers", shareId: parsed.link.shareId, relayUrl: parsed.link.relayUrl });
    throw error;
  }
  const withAnnotations = opened.share.manifest.papers.some((paper) => (paper.annotations?.length ?? 0) > 0);
  return { status: "imported", summary, withAnnotations };
}
