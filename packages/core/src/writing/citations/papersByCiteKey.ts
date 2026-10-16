/** Indexes library papers by cite key, the way every writing feature resolves a citation. */
import type { PaperRecord } from "../../model/index.js";

/** Keys are case-sensitive, as in BibTeX. */
export function papersByCiteKey(papers: readonly PaperRecord[]): Map<string, PaperRecord> {
  const byKey = new Map<string, PaperRecord>();
  // INVARIANT: on a duplicate cite key the paper with the smallest id wins, so the result does not depend on scan order.
  const ordered = [...papers].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const paper of ordered) { if (!byKey.has(paper.citeKey)) { byKey.set(paper.citeKey, paper); } }
  return byKey;
}
