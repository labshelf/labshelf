/** Builds the one-line publication summary of a paper: venue, year, volume(issue), pages. */
import type { PaperRecord } from "../../model/index.js";

type VenueFields = Pick<PaperRecord, "journal" | "publisher" | "year" | "volume" | "issue" | "pages">;

/** @returns "Nature · 2017 · 12(3) · pp. 45–67"; missing parts are skipped and the issue needs a volume; "" when nothing is known. */
export function formatVenueLine(fields: { [K in keyof VenueFields]?: VenueFields[K] | undefined }): string {
  const parts: string[] = [];
  const venue = fields.journal || fields.publisher;
  if (venue) { parts.push(venue); }
  if (fields.year) { parts.push(String(fields.year)); }
  if (fields.volume) { parts.push(fields.issue ? `${fields.volume}(${fields.issue})` : fields.volume); }
  if (fields.pages) { parts.push(`pp. ${fields.pages}`); }
  return parts.join(" · ");
}
