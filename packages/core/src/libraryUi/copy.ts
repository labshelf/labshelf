// Words and shapes what the library UI hands the user or the clipboard: PDF messages, batch outcome notices, citations, the request-a-copy email, sidecar summaries and paper titles.
import { formatDay } from "../time/index.js";
import type { PdfAccess, PdfMiss, PaperDetails, PaperStats } from "./protocol/index.js";
import { ROOT_LABEL, formatCitations, formatAuthors, derivePaperUrl } from "../library/index.js";
import { formatCount } from "../ui/index.js";
import { createBibtexEntry } from "../import/bibtex/index.js";
import type { PaperRecord, Annotation } from "../model/index.js";
import type { CitationFormat } from "./store/index.js";
import type { ILogger } from "../ports/index.js";

export const ASK_AUTHOR_LABEL = "Ask the author";

/** The detail line of a paper whose authors were asked for a copy on `day` (YYYY-MM-DD). */
export function formatPdfRequestedLine(day: string): string {
  return `PDF requested from the author on ${formatDay(day)}`;
}

const SOURCE_LABELS: Record<string, string> = {
  page: "this page",
  scholar: "Google Scholar",
  publisher: "the publisher",
  arxiv: "arXiv",
  crossref: "CrossRef",
  unpaywall: "Unpaywall (open access)",
  pubmed: "PubMed",
  custom: "Custom resolver",
};

const BOT_CHECK_HINT = " Some links were behind a bot check — opening the PDF once in a tab can let LabShelf through.";
const ACCESS_HINTS: Record<PdfAccess["kind"], string> = {
  login: " The publisher asks you to sign in. Open the page and sign in there, and LabShelf attaches the PDF on its own.",
  bot: " A bot check stood in the way. Open the page and pass the check there, and LabShelf attaches the PDF on its own.",
};

/** The label of the button that opens a miss's access page. */
export function formatPdfAccessLabel(access: PdfAccess): string {
  return access.kind === "login" ? "Open to sign in" : "Open to pass the check";
}

function missHint(miss: PdfMiss): string {
  if (miss.access) return ACCESS_HINTS[miss.access.kind];
  return miss.blocked ? BOT_CHECK_HINT : "";
}

/** Human label for a resolver name. */
export function formatPdfSourceLabel(source: string | undefined): string {
  return (source && SOURCE_LABELS[source]) || source || "the web";
}

// "this page, the publisher and Unpaywall (open access)": de-duplicated labels joined without an Oxford comma.
function joinLabels(sources: string[]): string {
  const labels = [...new Set(sources.map(formatPdfSourceLabel))];
  if (labels.length === 0) return "the web";
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]!}`;
}

/** The "No PDF found" dialog shown before a capture saves a reference without its PDF. */
export function createNoPdfDialogCopy(title: string, miss: PdfMiss): { title: string; message: string } {
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

export interface BatchError {
  id: string;
  error: string;
}

export interface OutcomeNotice {
  kind: "ok" | "error";
  text: string;
}

/** "1 paper" / "3 papers". */
export function formatPaperCount(n: number): string {
  return formatCount(n, "paper");
}

/** Trims tags and drops empty ones. */
export function deriveCleanTags(tags: readonly string[]): string[] {
  return tags.map((t) => t.trim()).filter(Boolean);
}

/** The error notice for papers whose status or tags could not be written. */
export function formatKeptFieldNotice(field: "status" | "tags", failed: number, error: string): string {
  return `${formatPaperCount(failed)} kept their ${field} — ${error}`;
}

/** @returns a lookup from a paper id to its title, falling back to the id itself for a paper not in `papers`. */
export function titleResolver(papers: readonly { id: string; title: string }[]): (id: string) => string {
  return (id) => papers.find((p) => p.id === id)?.title ?? id;
}

// `0 moved, 2 failed — "Title" — reason`: names the first failing paper so the user can find it.
function partialFailure(done: number, doneVerb: string, failed: readonly BatchError[], titleOf: (id: string) => string): string {
  const first = failed[0]!;
  return `${done} ${doneVerb}, ${failed.length} failed — "${titleOf(first.id)}" — ${first.error}`;
}

/** The notice after a move, or undefined when nothing moved and nothing failed. `where` is a folder name, or undefined for the root. */
export function moveNotice(
  done: number, failed: readonly BatchError[], where: string | undefined, titleOf: (id: string) => string,
): OutcomeNotice | undefined {
  if (failed.length) return { kind: "error", text: partialFailure(done, "moved", failed, titleOf) };
  if (done > 0) return { kind: "ok", text: `${formatPaperCount(done)} moved to ${where ?? ROOT_LABEL}` };
  return undefined;
}

/** The notice after papers go to the trash, or undefined when nothing was removed and nothing failed. */
export function removeNotice(done: readonly string[], failed: readonly BatchError[], titleOf: (id: string) => string): OutcomeNotice | undefined {
  if (failed.length) return { kind: "error", text: partialFailure(done.length, "removed", failed, titleOf) };
  if (done.length === 1) return { kind: "ok", text: `Removed "${titleOf(done[0]!)}"` };
  if (done.length > 1) return { kind: "ok", text: `Removed ${formatPaperCount(done.length)}` };
  return undefined;
}

export type CopyFormat = "key" | CitationFormat;

/** @returns one paper's text in a citation style */
export function formatCitation(p: PaperRecord, format: CitationFormat): string {
  return format === "bibtex" ? createBibtexEntry(p, { includeFile: false }) : formatCitations(p)[format];
}

/** @returns the papers' texts in list order: keys comma-joined for a citation command, BibTeX entries blank-line separated */
export function joinCitations(papers: PaperRecord[], format: CopyFormat): string {
  if (format === "key") return papers.map((p) => p.citeKey).join(",");
  return papers.map((p) => formatCitation(p, format)).join(format === "bibtex" ? "\n\n" : "\n");
}

interface Wording {
  subject: string;
  greeting: string;
  intro: string;
  ask: string;
  thanks: string;
}

const WORDING: Record<RequestLanguage, Wording> = {
  en: {
    subject: "Request for a copy of",
    greeting: "Dear author,",
    intro: "I came across your paper and would like to read it, but I do not have access to the full text:",
    ask: "Could you please send me a copy? It is for my personal research.",
    thanks: "Thank you very much,",
  },
  pt: {
    subject: "Pedido de cópia de",
    greeting: "Prezado(a) autor(a),",
    intro: "Encontrei o seu artigo e gostaria de lê-lo, mas não tenho acesso ao texto completo:",
    ask: "Poderia me enviar uma cópia? É para a minha pesquisa pessoal.",
    thanks: "Muito obrigado(a),",
  },
  es: {
    subject: "Solicitud de una copia de",
    greeting: "Estimado/a autor/a,",
    intro: "He encontrado su artículo y me gustaría leerlo, pero no tengo acceso al texto completo:",
    ask: "¿Podría enviarme una copia? Es para mi investigación personal.",
    thanks: "Muchas gracias,",
  },
};

function subjectText(lang: RequestLanguage, title: string): string {
  return `${WORDING[lang].subject} "${title}"`;
}

interface BodyParts {
  citation: string;
  /** The DOI resolver address, when the paper has a DOI. */
  link: string | undefined;
  name: string;
  affiliation: string;
}

/** @returns the email body, lines separated by CRLF as RFC 6068 asks; the name and affiliation lines are left out when empty */
function bodyText(lang: RequestLanguage, parts: BodyParts): string {
  const w = WORDING[lang];
  const lines = [w.greeting, "", w.intro, "", parts.citation];
  if (parts.link) { lines.push(parts.link); }
  lines.push("", w.ask, "", w.thanks);
  if (parts.name) { lines.push(parts.name); }
  if (parts.affiliation) { lines.push(parts.affiliation); }
  return lines.join("\r\n");
}

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
export function createCopyRequestMailto({ to, paper, requester, lang }: CopyRequest): string {
  const name = truncate(requester.name.trim(), MAX_REQUESTER_FIELD);
  const affiliation = truncate(requester.affiliation.trim(), MAX_REQUESTER_FIELD);
  const link = paper.doi?.trim() ? derivePaperUrl({ doi: paper.doi }) : undefined;
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

export const REQUEST_LANGUAGES = ["en", "pt", "es"] as const;
export type RequestLanguage = (typeof REQUEST_LANGUAGES)[number];

export const REQUEST_LANGUAGE_NAME: Record<RequestLanguage, string> = { en: "English", pt: "Português", es: "Español" };

export function isRequestLanguage(value: unknown): value is RequestLanguage {
  return (REQUEST_LANGUAGES as readonly unknown[]).includes(value);
}

/** @returns the email language for a tag such as "pt-BR" or "es"; English when the tag is missing or unsupported */
export function deriveRequestLanguage(tag: string | undefined): RequestLanguage {
  const base = tag?.toLowerCase().split(/[-_]/)[0];
  return isRequestLanguage(base) ? base : "en";
}

/** The part of a sidecar the library UI reads. */
export interface SidecarView {
  annotations: Annotation[];
  reading?: { page: number; updatedAt: string };
}

export function derivePaperStats(data: SidecarView): PaperStats {
  const { annotations, reading } = data;
  return {
    annotations: annotations.length,
    ...(reading ? { lastPage: reading.page, lastRead: reading.updatedAt } : {}),
  };
}

export function derivePaperDetails(data: SidecarView, pdf: PaperDetails["pdf"]): PaperDetails {
  const { annotations, reading } = data;
  return { annotations, reading: reading ? { page: reading.page, updatedAt: reading.updatedAt } : null, pdf };
}

export interface SidecarReader {
  /** The stats of one paper, or undefined when its sidecar cannot be read. */
  statsFor(paperId: string): Promise<PaperStats | undefined>;
  /** The stats of every paper whose sidecar can be read; an unreadable sidecar only costs that row its marks. */
  statsOf(papers: ReadonlyArray<{ id: string }>): Promise<Record<string, PaperStats>>;
  /** The sidecar of one paper; an unreadable one reads as having no annotations. */
  summaryOf(paperId: string): Promise<SidecarView>;
}

export function createSidecarReader(load: (paperId: string) => Promise<SidecarView>, logger: ILogger, module: string): SidecarReader {
  const warn = (message: string, paperId: string, error: unknown): Promise<void> => logger.log("WARN", module, message, { paperId, message: String(error) });

  const statsFor = async (paperId: string): Promise<PaperStats | undefined> => {
    try {
      return derivePaperStats(await load(paperId));
    } catch (error) {
      await warn("Sidecar could not be read for the list", paperId, error);
      return undefined;
    }
  };

  return {
    statsFor,
    async statsOf(papers) {
      const stats: Record<string, PaperStats> = {};
      await Promise.all(papers.map(async ({ id }) => {
        const one = await statsFor(id);
        if (one) stats[id] = one;
      }));
      return stats;
    },
    async summaryOf(paperId) {
      try {
        return await load(paperId);
      } catch (error) {
        await warn("Sidecar could not be read; showing no annotations", paperId, error);
        return { annotations: [] };
      }
    },
  };
}
