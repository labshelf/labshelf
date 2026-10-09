/** Builds the differently-shaped queries the registry search tries for a paper that states no identifier. */
import { asString } from "../../metadata/index.js";
import { normalizeAuthors } from "../authors.js";
import type { PdfSignals } from "./readPdf.js";

const ABSTRACT_QUERY_CHARS = 300;

export function searchQueries(
  signals: PdfSignals,
  localTitle: string | undefined,
  frontMatter: string,
  abstract: string | undefined,
): Array<string | undefined> {
  const author = firstAuthorHint(signals);
  return [
    localTitle,
    localTitle && author ? `${localTitle} ${author}` : undefined,
    frontMatterQuery(frontMatter),
    abstract?.slice(0, ABSTRACT_QUERY_CHARS),
  ];
}

// The masthead holds the title and authors; feeding the whole page to a search
// index buries them under boilerplate and affiliations.
function frontMatterQuery(text: string): string | undefined {
  const head = text.replace(/\s+/g, " ").trim().slice(0, 400);
  return head.length >= 20 ? head : undefined;
}

// A surname next to a generic title is often what makes a search unambiguous.
function firstAuthorHint(signals: PdfSignals): string | undefined {
  const author = signals.xmp?.authors?.[0] ?? normalizeAuthors(asString(signals.info["Author"]))[0];
  return author?.split(/\s+/).pop();
}
