/** Reads the PDF Info dictionary: publisher-stamped keys and whether its timestamps can be trusted. */
import { extractDoi } from "../identifiers/index.js";
import { asString, extractYear, type ResolvedMetadata } from "../metadata/index.js";

// Tools that re-print an existing document stamp CreationDate with the moment
// the user saved the copy, which says nothing about when the paper was published.
const REPRINT_PRODUCERS = /quartz pdfcontext|skia\/pdf|preview|print to pdf|microsoft: print to pdf|cairo|ghostscript|pdfcreator|chrome|safari|firefox/i;

/**
 * Reports whether a PDF's timestamps reflect publication or merely the moment
 * someone re-saved the file, in which case the year must not be trusted.
 * @returns true when CreationDate/ModDate are a usable year source.
 */
export function timestampsAreTrustworthy(pdfInfo: Record<string, unknown>): boolean {
  const producer = `${asString(pdfInfo["Producer"]) ?? ""} ${asString(pdfInfo["Creator"]) ?? ""}`;
  return !REPRINT_PRODUCERS.test(producer);
}

/**
 * Harvests the non-standard Info dictionary keys publishers stamp into their
 * PDFs (`WPS-ARTICLEDOI`, `JournalTitle`, `FirstPage`, …), which carry real
 * bibliographic data the standard keys never do.
 * @returns The fields found, or undefined when the dictionary holds none.
 */
export function publisherMetadataFromInfo(pdfInfo: Record<string, unknown>): ResolvedMetadata | undefined {
  const entries = lowercaseEntries(pdfInfo);
  if (entries.size === 0) {
    return undefined;
  }

  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = entries.get(key);
      if (value) {
        return value;
      }
    }
    return undefined;
  };

  // Vendors prefix their DOI key with a product code, so it is matched by
  // substring while the bare `doi` key is matched exactly.
  const doi = extractDoi(findByFragment(entries, "articledoi") ?? pick("doi"));
  const firstPage = pick("firstpage");
  const lastPage = pick("lastpage");

  return presentFields({
    doi,
    journal: pick("journaltitle", "journal", "publicationtitle"),
    volume: pick("volumenum", "volume"),
    issue: pick("issuenum", "issue", "number"),
    pages: firstPage && lastPage && firstPage !== lastPage ? `${firstPage}-${lastPage}` : firstPage,
    issn: pick("issn"),
    publisher: pick("publisher"),
    year: extractYear(pick("copyright")),
  });
}

// Under exactOptionalPropertyTypes an absent field must be omitted, not set to undefined.
function presentFields(fields: ResolvedMetadata): ResolvedMetadata | undefined {
  const present = Object.entries(fields).filter(([, value]) => value !== undefined && value !== "");
  return present.length > 0 ? (Object.fromEntries(present) as ResolvedMetadata) : undefined;
}

function lowercaseEntries(pdfInfo: Record<string, unknown>): Map<string, string> {
  const entries = new Map<string, string>();
  for (const [key, value] of Object.entries(pdfInfo ?? {})) {
    const text = typeof value === "string" ? value.trim() : "";
    const normalized = key.toLowerCase();
    if (text && !entries.has(normalized)) {
      entries.set(normalized, text);
    }
  }
  return entries;
}

function findByFragment(entries: Map<string, string>, fragment: string): string | undefined {
  for (const [key, value] of entries) {
    if (key.includes(fragment)) {
      return value;
    }
  }
  return undefined;
}
