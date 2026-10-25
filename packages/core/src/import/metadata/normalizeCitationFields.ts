/** Puts volume and page range in the form a citation prints them. */
import type { ResolvedMetadata } from "./resolvedMetadata.js";

/**
 * Registries differ: Semantic Scholar reports volume "25 3" (volume and issue
 * together), and PubMed abbreviates page ranges the way MEDLINE does ("111-9"
 * for 111-119).
 * @returns The same record with volume and pages normalized.
 */
export function normalizeCitationFields(metadata: ResolvedMetadata): ResolvedMetadata {
  const tidy: ResolvedMetadata = { ...metadata };
  const volume = metadata.volume?.trim();
  const issue = metadata.issue?.trim();
  if (volume && issue && volume.endsWith(` ${issue}`)) {
    tidy.volume = volume.slice(0, -issue.length - 1).trim();
  } else if (volume && !issue) {
    // "25 3" with no issue elsewhere: the second number is the issue.
    const split = volume.match(/^(\d+)\s+\(?(\d+)\)?$/);
    if (split) {
      tidy.volume = split[1]!;
      tidy.issue = split[2]!;
    }
  }
  if (metadata.pages) {
    tidy.pages = expandPageRange(metadata.pages);
  }
  return tidy;
}

// "111-9" → "111-119", "1023-31" → "1023-1031"; complete ranges stay as they are.
function expandPageRange(pages: string): string {
  const range = pages.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!range) {
    return pages;
  }
  const [, first, last] = range as unknown as [string, string, string];
  if (last.length >= first.length || Number(last) >= Number(first)) {
    return `${first}-${last}`;
  }
  return `${first}-${first.slice(0, first.length - last.length)}${last}`;
}
