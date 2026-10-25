// Counts the pages a venue's page limit applies to, from the paper's body and its total page count.
import type { CountUpTo } from "../../project/index.js";
import type { PaperBody } from "../derivePaperBody.js";

export function deriveCountedPages(body: PaperBody, totalPages: number, countUpTo: CountUpTo): { pages: number; headingFound: boolean } {
  return { pages: countUpTo === "end" ? totalPages : body.contentPages, headingFound: body.headingFound };
}
