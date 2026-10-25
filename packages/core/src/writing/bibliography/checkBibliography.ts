/** Lints the text of a user's .bib file: duplicates, missing DOIs and preprints with a published version. */
import { BIBLIOGRAPHY_HEADER } from "../citations/index.js";
import { bibEntries, plainField, type BibEntry } from "./bibEntries.js";
import type { BibFinding } from "./bibliographyReport.js";
import { publishedVersionFindings, type PublishedVersionLookup } from "./publishedVersionRule.js";
import { extractDoi } from "../../import/index.js";
import { titleKey } from "../../library/index.js";
import { preprintIdsOf } from "./preprintIds.js";

// Types whose works usually have a DOI; a missing one on a book, thesis or web page is normal.
const DOI_TYPES = new Set(["article", "inproceedings", "incollection", "conference"]);

/** Each repeated entry after the first gets a warning: same key, same DOI, or same title. */
function duplicateFindings(text: string, entries: readonly BibEntry[]): BibFinding[] {
  const byKey = new Map<string, BibEntry>();
  const byDoi = new Map<string, BibEntry>();
  const byTitle = new Map<string, BibEntry>();
  const findings: BibFinding[] = [];
  for (const entry of entries) {
    const doi = extractDoi(plainField(entry.fields.get("doi")))?.toLowerCase();
    const title = titleKey(plainField(entry.fields.get("title")));
    const sameKey = byKey.get(entry.key);
    const first = sameKey ?? (doi ? byDoi.get(doi) : undefined) ?? (title ? byTitle.get(title) : undefined);
    if (sameKey) {
      findings.push(duplicate(entry, `${entry.key} is defined twice; BibTeX uses the first one.`, removal(text, entry)));
    } else if (first) {
      const reason = doi && byDoi.get(doi) ? "the same DOI" : "the same title";
      findings.push(duplicate(entry, `${entry.key} has ${reason} as ${first.key}.`));
    }
    if (!byKey.has(entry.key)) { byKey.set(entry.key, entry); }
    if (doi && !byDoi.has(doi)) { byDoi.set(doi, entry); }
    if (title && !byTitle.has(title)) { byTitle.set(title, entry); }
  }
  return findings;
}

/** Articles and proceedings papers without a DOI; preprints are left to the published-version rule. */
function missingDoiFindings(entries: readonly BibEntry[]): BibFinding[] {
  return entries
    .filter((entry) => DOI_TYPES.has(entry.type) && !entry.fields.has("doi") && !preprintIdsOf(entry))
    .map((entry) => ({
      rule: "missing-doi", severity: "information", key: entry.key, start: entry.start, end: entry.end,
      message: `${entry.key} has no DOI.`,
    }));
}

function duplicate(entry: BibEntry, message: string, fix?: BibFinding["fix"]): BibFinding {
  const finding: BibFinding = { rule: "duplicate", severity: "warning", key: entry.key, start: entry.start, end: entry.end, message };
  if (fix) { finding.fix = fix; }
  return finding;
}

// A second entry with the same key is dead text, so removing it changes nothing BibTeX reads.
function removal(text: string, entry: BibEntry): BibFinding["fix"] {
  const lineStart = text.lastIndexOf("\n", entry.start - 1) + 1;
  const start = text.slice(lineStart, entry.start).trim() === "" ? lineStart : entry.start;
  const end = text[entry.end] === "\n" ? entry.end + 1 : entry.end;
  return { title: `Remove the second ${entry.key}`, start, end, text: "" };
}

/** Findings in file order; LabShelf's generated labshelf.bib gets none, because the library rewrites it on every change. */
export async function lintBibliography(text: string, lookup: PublishedVersionLookup): Promise<BibFinding[]> {
  if (text.startsWith(BIBLIOGRAPHY_HEADER)) { return []; }
  const entries = bibEntries(text);
  const findings = [
    ...duplicateFindings(text, entries),
    ...missingDoiFindings(entries),
    ...await publishedVersionFindings(entries, lookup),
  ];
  return findings.sort((a, b) => a.start - b.start);
}
