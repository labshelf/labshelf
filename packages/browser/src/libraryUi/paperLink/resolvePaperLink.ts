// Resolves the text of a labshelf: link to the paper and page it points at, or to the message that explains why it cannot open.
import { papersByCiteKey, parsePaperLink, type PaperRecord } from "@labshelf/core";

export type LinkResolution =
  | { readonly ok: true; readonly paperId: string; readonly page?: number }
  | { readonly ok: false; readonly message: string };

export function resolveLink(text: string, papers: readonly PaperRecord[]): LinkResolution {
  const link = parsePaperLink(text);
  if (!link) return { ok: false, message: `"${text}" is not a LabShelf link.` };
  const paper = papersByCiteKey(papers).get(link.citeKey);
  if (!paper) return { ok: false, message: `No paper in your library has the cite key "${link.citeKey}".` };
  return link.page === undefined ? { ok: true, paperId: paper.id } : { ok: true, paperId: paper.id, page: link.page };
}
