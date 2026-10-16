// Builds the mailto: link that asks an author for a copy of a paper, within the length mail clients accept.
import { formatAuthors, paperLink } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import { bodyText, subjectText } from "./requestCopyText.js";
import type { RequestLanguage } from "./requestLanguage.js";

/** Longest mailto: URL the builder returns; mail clients and browsers start to refuse links past about 2,000. */
export const MAILTO_MAX_LENGTH = 1800;

const ELLIPSIS = "…";
// Fewest characters the shortening steps leave: enough to recognise the paper.
const MIN_AUTHORS = 30;
const MIN_BODY_TITLE = 40;
const MAX_REQUESTER_FIELD = 120;

export interface CopyRequest {
  /** Addresses to write to; an empty list leaves the recipient for the user to fill in. */
  to: readonly string[];
  paper: Pick<PaperRecord, "title" | "authors" | "year" | "journal" | "publisher" | "doi">;
  requester: { name: string; affiliation: string };
  lang: RequestLanguage;
}

interface Fit {
  authors: string;
  bodyTitle: string;
  subjectTitle: string;
}

// RFC 6068: percent-encode everything but unreserved characters, so a space is %20 and a line break %0D%0A.
// "@" stays readable in the recipient list.
const encode = (text: string): string => encodeURIComponent(text).replace(/%40/g, "@");

// Cuts by code points, so a surrogate pair is never split, and ends with an ellipsis.
function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}${ELLIPSIS}`;
}

// The longest truncation of `text` that `fits`, but never under `floor` characters; `text` itself when it fits.
function shortest(text: string, floor: number, fits: (candidate: string) => boolean): string {
  if (fits(text)) { return text; }
  let low = Math.min(floor, Array.from(text).length);
  if (!fits(truncate(text, low))) { return truncate(text, low); }
  let high = Array.from(text).length;
  // INVARIANT: the truncation at `low` fits and the one at `high` does not; a longer prefix never encodes shorter.
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (fits(truncate(text, mid))) { low = mid; } else { high = mid; }
  }
  return truncate(text, low);
}

function citation(paper: CopyRequest["paper"], fit: Fit): string {
  const titled = /[.?!]$/.test(fit.bodyTitle) ? fit.bodyTitle : `${fit.bodyTitle}.`;
  const venue = paper.journal || paper.publisher;
  const lead = [fit.authors, paper.year ? `(${paper.year}).` : ""].filter(Boolean).join(" ");
  return [lead, titled, venue ? `${venue}.` : ""].filter(Boolean).join(" ");
}

/**
 * Builds a mailto: link with the subject, a one-line citation, the DOI link and the requester's signature.
 * When the link would pass MAILTO_MAX_LENGTH it shortens the citation's authors, then the title in the body, then the title in the subject.
 * @returns the mailto: URL; longer than the cap only when the recipients and signature alone exceed it
 */
export function requestCopyMailto({ to, paper, requester, lang }: CopyRequest): string {
  const name = truncate(requester.name.trim(), MAX_REQUESTER_FIELD);
  const affiliation = truncate(requester.affiliation.trim(), MAX_REQUESTER_FIELD);
  const link = paper.doi?.trim() ? paperLink({ doi: paper.doi }) : undefined;
  const recipients = to.map(encode).join(",");
  const render = (fit: Fit): string => {
    const body = bodyText(lang, { citation: citation(paper, fit), link, name, affiliation });
    return `mailto:${recipients}?subject=${encode(subjectText(lang, fit.subjectTitle))}&body=${encode(body)}`;
  };
  const fits = (fit: Fit): boolean => render(fit).length <= MAILTO_MAX_LENGTH;

  let fit: Fit = { authors: formatAuthors(paper.authors), bodyTitle: paper.title, subjectTitle: paper.title };
  fit = { ...fit, authors: shortest(fit.authors, MIN_AUTHORS, (authors) => fits({ ...fit, authors })) };
  fit = { ...fit, bodyTitle: shortest(fit.bodyTitle, MIN_BODY_TITLE, (bodyTitle) => fits({ ...fit, bodyTitle })) };
  fit = { ...fit, subjectTitle: shortest(fit.subjectTitle, 0, (subjectTitle) => fits({ ...fit, subjectTitle })) };
  return render(fit);
}
