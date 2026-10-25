// Attaches to each citation card the fix that suits it: replace a missing key, add a bib entry or update its venue.
import { deriveSuggestedCiteKey, type CitationCardFix, type CitationEntry } from "@labshelf/core";
import { PREVIEW_LOG_MODULE } from "../previewStrings.js";
import type { CitationFixDeps } from "./citationFixDeps.js";
import { publishedVenueOf } from "./updateBibEntry.js";

async function fixOf(deps: CitationFixDeps, entry: CitationEntry): Promise<CitationCardFix | undefined> {
  if (!entry.paper && !entry.bib) {
    const suggestion = deriveSuggestedCiteKey(entry.key, await deps.shelfKeys());
    return suggestion ? { kind: "replace", suggestion } : undefined;
  }
  if (entry.bib && !entry.paper) { return { kind: "add" }; }
  if (!entry.bib) { return undefined; }
  const venue = await publishedVenueOf(deps, entry.key);
  return venue ? { kind: "update", venue } : undefined;
}

export function withCitationFixes(deps: CitationFixDeps, entries: CitationEntry[]): Promise<CitationEntry[]> {
  return Promise.all(entries.map(async (entry) => {
    try {
      const fix = await fixOf(deps, entry);
      return fix ? { ...entry, fix } : entry;
    } catch (error) {
      await deps.logger.log("WARN", PREVIEW_LOG_MODULE, "Citation fix lookup failed", { key: entry.key, error: String(error) });
      return entry;
    }
  }));
}
