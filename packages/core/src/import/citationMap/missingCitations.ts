// Counts which works the library's papers cite but the library lacks, and which library papers cite each other.

import type { OpenAlexCitationWork } from "../registries/index.js";

/** A library paper OpenAlex resolved. */
export interface ResolvedPaper {
  paperId: string;
  work: OpenAlexCitationWork;
}

/** One library paper citing another. */
export interface CitationLink {
  from: string;
  to: string;
}

/** A work outside the library and the library papers that cite it. */
export interface MissingCandidate {
  workId: string;
  citedBy: string[];
}

/**
 * Splits the references of resolved library papers into links between library papers and works the library lacks.
 * @returns the links, and the missing works cited by at least `minCitingPapers` papers, most cited first
 */
export function countMissingCitations(
  resolved: ResolvedPaper[],
  minCitingPapers: number,
): { links: CitationLink[]; candidates: MissingCandidate[] } {
  const paperOfWork = new Map<string, string>();
  for (const { paperId, work } of resolved) {
    if (!paperOfWork.has(work.workId)) {
      paperOfWork.set(work.workId, paperId);
    }
  }
  const links: CitationLink[] = [];
  const citers = new Map<string, Set<string>>();
  for (const { paperId, work } of resolved) {
    const linked = new Set<string>();
    for (const ref of work.references) {
      const target = paperOfWork.get(ref);
      if (target === undefined) {
        citers.set(ref, (citers.get(ref) ?? new Set()).add(paperId));
      } else if (target !== paperId && !linked.has(target)) {
        linked.add(target);
        links.push({ from: paperId, to: target });
      }
    }
  }
  const candidates = [...citers]
    .filter(([, papers]) => papers.size >= minCitingPapers)
    .map(([workId, papers]) => ({ workId, citedBy: [...papers] }))
    .sort((a, b) => b.citedBy.length - a.citedBy.length || a.workId.localeCompare(b.workId));
  return { links, candidates };
}
