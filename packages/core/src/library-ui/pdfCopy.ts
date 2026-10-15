/**
 * Defines the wording of a paper's PDF status on every surface: resolver labels and the "No PDF found" texts.
 */
import type { PdfAccess, PdfMiss } from "./protocol/index.js";

const SOURCE_LABELS: Record<string, string> = {
  page: "this page",
  scholar: "Google Scholar",
  publisher: "the publisher",
  arxiv: "arXiv",
  crossref: "CrossRef",
  unpaywall: "Unpaywall (open access)",
  pubmed: "PubMed",
  "sci-hub": "Sci-Hub",
};

const BOT_CHECK_HINT = " Some links were behind a bot check — opening the PDF once in a tab can let LabShelf through.";
const ACCESS_HINTS: Record<PdfAccess["kind"], string> = {
  login: " The publisher asks you to sign in. Open the page and sign in there, and LabShelf attaches the PDF on its own.",
  bot: " A bot check stood in the way. Open the page and pass the check there, and LabShelf attaches the PDF on its own.",
};

/** The label of the button that opens a miss's access page. */
export function pdfAccessLabel(access: PdfAccess): string {
  return access.kind === "login" ? "Open to sign in" : "Open to pass the check";
}

function missHint(miss: PdfMiss): string {
  if (miss.access) return ACCESS_HINTS[miss.access.kind];
  return miss.blocked ? BOT_CHECK_HINT : "";
}

/** Human label for a resolver name. */
export function pdfSourceLabel(source: string | undefined): string {
  return (source && SOURCE_LABELS[source]) || source || "the web";
}

// "this page, the publisher and Unpaywall (open access)": de-duplicated labels joined without an Oxford comma.
function joinLabels(sources: string[]): string {
  const labels = [...new Set(sources.map(pdfSourceLabel))];
  if (labels.length === 0) return "the web";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]!}`;
}

/** The "No PDF found" dialog shown before a capture saves a reference without its PDF. */
export function noPdfDialogCopy(title: string, miss: PdfMiss): { title: string; message: string } {
  const quoted = `"${title}"`;
  const message = miss.tried === 0
    ? `No PDF link, DOI or arXiv id was found for ${quoted}. Save the reference without a PDF? You can attach one later from the library.`
    : `Tried ${miss.tried} ${miss.tried === 1 ? "link" : "links"} from ${joinLabels(miss.sources)}. Save ${quoted} without its PDF? You can attach one later from the library.`;
  return { title: "No PDF found", message: message + missHint(miss) };
}

/** The "No PDF found" message for a paper already in the library, after Find PDF came back empty. */
export function findMissMessage(title: string, miss: PdfMiss): string {
  const head = miss.tried > 0
    ? `LabShelf tried ${miss.tried} ${miss.tried === 1 ? "link" : "links"} but could not download a PDF for "${title}".`
    : `LabShelf found no PDF link, DOI or arXiv id for "${title}".`;
  return `${head} Attach a file you already have, or search again later.${missHint(miss)}`;
}
