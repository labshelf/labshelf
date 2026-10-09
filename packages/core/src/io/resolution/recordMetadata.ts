/** The bibliographic fields a stored paper record states, in the shape metadata resolution and PDF finding read. */
import type { PaperRecord } from "../../model/index.js";
import type { ResolvedMetadata } from "../pdf/index.js";

const OPTIONAL_FIELDS = ["authors", "year", "journal", "publisher", "volume", "issue", "pages", "doi", "url", "issn", "language", "summary", "keywords"] as const;

export function metadataFromRecord(r: PaperRecord): ResolvedMetadata {
  const metadata: ResolvedMetadata = { title: r.title };
  for (const field of OPTIONAL_FIELDS) {
    const value = r[field];
    if (value !== undefined) Object.assign(metadata, { [field]: value });
  }
  return metadata;
}
