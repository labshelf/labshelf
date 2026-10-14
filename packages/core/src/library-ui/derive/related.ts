/**
 * The Related tab's groups for one paper: papers with similar content (from the host), the same authors, shared tags
 * or keywords, and the same venue, each drawn from the whole library.
 */
import { authorKey } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { SimilarPaper } from "../protocol/index.js";

export interface RelatedGroups {
  similar: Array<{ paper: PaperRecord; score: number }>;
  authors: PaperRecord[];
  /** Papers sharing tags or keywords, most shared first, with the shared terms. */
  shared: Array<{ paper: PaperRecord; common: string[] }>;
  venue: PaperRecord[];
  /** Distinct papers across every group. */
  total: number;
}

const newestFirst = (a: PaperRecord, b: PaperRecord): number => (b.year ?? 0) - (a.year ?? 0);
const venueOf = (p: PaperRecord): string => (p.journal ?? p.publisher ?? "").toLowerCase();

function sharedTerms(p: PaperRecord, others: PaperRecord[]): RelatedGroups["shared"] {
  const mine = new Set([...(p.tags ?? []), ...(p.keywords ?? [])].map((t) => t.toLowerCase()));
  return others
    .map((q) => {
      const seen = new Set<string>();
      const common = [...(q.tags ?? []), ...(q.keywords ?? [])].filter((t) => {
        const k = t.toLowerCase();
        if (!mine.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return { paper: q, common };
    })
    .filter((x) => x.common.length > 0)
    .sort((a, b) => b.common.length - a.common.length);
}

export function relatedGroups(p: PaperRecord, library: readonly PaperRecord[], similar: readonly SimilarPaper[] = []): RelatedGroups {
  const others = library.filter((q) => q.id !== p.id);
  const byId = new Map(others.map((q) => [q.id, q]));
  const myAuthors = new Set((p.authors ?? []).filter((a) => a.trim()).map(authorKey));
  const authors = others.filter((q) => (q.authors ?? []).some((a) => myAuthors.has(authorKey(a)))).sort(newestFirst);
  const venue = venueOf(p) ? others.filter((q) => venueOf(q) === venueOf(p)).sort(newestFirst) : [];
  const shared = sharedTerms(p, others);
  const sim = similar.flatMap((s) => {
    const paper = byId.get(s.paperId);
    return paper ? [{ paper, score: s.score }] : [];
  });
  const ids = new Set([...authors, ...shared.map((x) => x.paper), ...venue, ...sim.map((x) => x.paper)].map((q) => q.id));
  return { similar: sim, authors, shared, venue, total: ids.size };
}
