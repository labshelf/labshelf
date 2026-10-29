// Turns a paper's metadata.yaml into its record and holds the paper-level rules built on it: reading status, tags, author names,
// citation styles, venue line, paper URL, labshelf: links, file size text and the title match key.
// INVARIANT: hasPdf comes from the folder listing, never from the file.
// CONTRACT: documents/contracts/links.md#grammar
import YAML from "yaml";

import { BIBLIOGRAPHIC_STRING_FIELDS, isPdfVersion, parseTextLayerDetails, type PaperRecord } from "../model/index.js";
import { normalizeText } from "./searchText.js";

// ---- metadata.yaml to record ----

export interface PaperDeviceFolder {
  /** Folder name, which is the paper id. */
  id: string;
  /** Absolute path of the paper folder on this device. */
  path: string;
  /** Whether <folder>/paper.pdf exists on this device. */
  hasPdf: boolean;
}

/**
 * Parses metadata.yaml text.
 * @returns the mapping, or undefined when the text is not a YAML mapping
 */
export function parsePaperMetadata(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = YAML.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Builds the record of one paper from its parsed metadata.yaml.
 * @returns the PaperRecord
 */
export function createPaperRecord(meta: Record<string, unknown>, location: PaperDeviceFolder): PaperRecord {
  const authors = stringList(meta["authors"]);
  const keywords = stringList(meta["keywords"]);
  const tags = stringList(meta["tags"]);
  const textLayer = parseTextLayerDetails(meta["textLayer"]);
  const status = meta["status"];
  const record: PaperRecord = {
    id: location.id,
    title: typeof meta["title"] === "string" ? meta["title"] : location.id,
    path: location.path,
    citeKey: typeof meta["citekey"] === "string" ? meta["citekey"] : location.id,
    status: isReadingStatus(status) ? status : "unread",
    hasPdf: location.hasPdf,
  };
  if (authors.length) { record.authors = authors; }
  if (typeof meta["year"] === "number") { record.year = meta["year"]; }
  for (const key of BIBLIOGRAPHIC_STRING_FIELDS) {
    const value = meta[key];
    if (typeof value === "string") { record[key] = value; }
  }
  if (keywords.length) { record.keywords = keywords; }
  if (textLayer) { record.textLayer = textLayer; }
  if (tags.length) { record.tags = tags; }
  if (isPdfVersion(meta["pdfVersion"])) { record.pdfVersion = meta["pdfVersion"]; }
  const files = fileDescriptions(meta["files"]);
  if (files) { record.files = files; }
  if (isIsoDay(meta["pdfRequestedAt"])) { record.pdfRequestedAt = meta["pdfRequestedAt"]; }
  if (isIsoTimestamp(meta["statusChangedAt"])) { record.statusChangedAt = meta["statusChangedAt"]; }
  return record;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value));
}

function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Keeps the string descriptions of a YAML mapping; undefined when none is left.
function fileDescriptions(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) { return undefined; }
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length ? Object.fromEntries(entries) : undefined;
}

// Keeps the string entries of a YAML list; anything else yields an empty list.
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// ---- reading status ----

export const PAPER_STATUSES = ["unread", "reading", "done"] as const;
export type ReadingStatus = (typeof PAPER_STATUSES)[number];

export const STATUS_LABEL: Record<ReadingStatus, string> = { unread: "Unread", reading: "Reading", done: "Done" };

export function isReadingStatus(value: unknown): value is ReadingStatus {
  return (PAPER_STATUSES as readonly unknown[]).includes(value);
}

/** The status a click on the status badge moves to: unread, reading, done, then unread again. */
export function deriveNextReadingStatus(status: ReadingStatus): ReadingStatus {
  return PAPER_STATUSES[(PAPER_STATUSES.indexOf(status) + 1) % PAPER_STATUSES.length]!;
}

// ---- tags ----

/** Trimmed, inner whitespace collapsed, blanks dropped, de-duplicated case-insensitively (first spelling wins), order kept. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/\s+/g, " ");
    const key = tag.toLowerCase();
    if (tag && !seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/** @returns `tags` without the ones in `remove` (ignoring case), with `add` appended, normalised */
export function deriveEditedTags(tags: readonly string[], add: readonly string[], remove: readonly string[]): string[] {
  const removeKeys = new Set(remove.map((tag) => tag.trim().toLowerCase()));
  return normalizeTags([...tags.filter((tag) => !removeKeys.has(tag.toLowerCase())), ...add]);
}

// ---- author names ----

export interface AuthorName {
  given: string;
  family: string;
}

// Lower-case name particles that belong to the family name: "Ludwig van Beethoven" is "van Beethoven".
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "du", "la", "le", "dos", "das"]);

/** @returns the given and family names of "Given Family" or "Family, Given"; a single word is a family name. */
export function splitName(raw: string): AuthorName {
  const name = raw.trim().replace(/\s+/g, " ");
  const comma = name.indexOf(",");
  if (comma !== -1) { return { family: name.slice(0, comma).trim(), given: name.slice(comma + 1).trim() }; }
  const parts = name.split(" ");
  let at = parts.length - 1;
  while (at > 1 && PARTICLES.has(parts[at - 1]!.toLowerCase())) { at--; }
  return { given: parts.slice(0, at).join(" "), family: parts.slice(at).join(" ") };
}

/** @returns the family name of "Last, First" or "First Last", particles included; the trimmed full name when none can be told. */
export function deriveFamilyName(author: string): string {
  return splitName(author).family || author.trim();
}

/** @returns "" for no authors, "A", "A & B" or "A et al." (three or more); blank entries are ignored. */
export function formatAuthors(authors: readonly string[] | undefined): string {
  const families = (authors ?? []).filter((a) => a.trim().length > 0).map(deriveFamilyName);
  if (families.length <= 2) { return families.join(" & "); }
  return `${families[0]} et al.`;
}

/** @returns "family|g", so "Ashish Vaswani" and "Vaswani, A." count as the same person. */
export function normalizeAuthor(author: string): string {
  const { given, family } = splitName(author);
  return `${family.toLowerCase()}|${given.charAt(0).toLowerCase()}`;
}

// ---- paper URL ----

const DOI_RESOLVER_PREFIX = /^https?:\/\/(?:dx\.)?doi\.org\//i;

/** @returns https://doi.org/<doi> (a DOI stored as a full resolver URL is not prefixed twice), else the URL, else undefined. */
export function derivePaperUrl(paper: Pick<PaperRecord, "doi" | "url">): string | undefined {
  const doi = paper.doi?.trim().replace(DOI_RESOLVER_PREFIX, "");
  if (doi) { return `https://doi.org/${doi}`; }
  return paper.url || undefined;
}

// ---- citation styles ----

export type CitedPaper = Pick<PaperRecord, "title" | "authors" | "year" | "journal" | "publisher" | "volume" | "issue" | "pages" | "doi" | "url">;

export interface CitationSet {
  apa: string;
  mla: string;
  chicago: string;
  /** Short in-text form, e.g. "Vaswani et al., 2017". */
  inText: string;
}

/** @returns "Family, year", "A & B, year" or "A et al., year"; the title stands in for no authors and "n.d." for no year. */
export function formatInTextCitation(paper: Pick<PaperRecord, "title" | "authors" | "year">): string {
  return `${formatAuthors(paper.authors) || paper.title}, ${paper.year ?? "n.d."}`;
}

/** @returns every reference style for one paper */
export function formatCitations(paper: CitedPaper): CitationSet {
  return { apa: apa(paper), mla: mla(paper), chicago: chicago(paper), inText: formatInTextCitation(paper) };
}

function initials(given: string): string {
  return given
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((part) => part.split("-").map((piece) => piece.charAt(0).toUpperCase() + ".").join("-"))
    .join(" ");
}

function names(paper: CitedPaper): AuthorName[] {
  return (paper.authors ?? []).filter((a) => a.trim()).map(splitName);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.?!]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

const dashes = (pages: string): string => pages.replace(/-+/g, "–");

function apaAuthors(list: AuthorName[]): string {
  const formatted = list.map((n) => (n.given ? `${n.family}, ${initials(n.given)}` : n.family));
  // Up to 20 authors with "&" before the last; beyond that, the first 19, an ellipsis and the last.
  if (formatted.length > 20) { return `${formatted.slice(0, 19).join(", ")}, … ${formatted[formatted.length - 1]}`; }
  if (formatted.length > 1) { return `${formatted.slice(0, -1).join(", ")}, & ${formatted[formatted.length - 1]}`; }
  return formatted.join("");
}

function apa(paper: CitedPaper): string {
  const authors = apaAuthors(names(paper));
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push(`(${paper.year ?? "n.d."}).`, sentence(paper.title));
  const venue = paper.journal ?? paper.publisher;
  if (venue) {
    let source = venue;
    if (paper.volume) { source += `, ${paper.volume}${paper.issue ? `(${paper.issue})` : ""}`; }
    if (paper.pages) { source += `, ${dashes(paper.pages)}`; }
    parts.push(`${source}.`);
  }
  const link = derivePaperUrl(paper);
  if (link) { parts.push(link); }
  return parts.join(" ");
}

function mlaAuthors(list: AuthorName[]): string {
  const [first, second] = list;
  if (!first) { return ""; }
  if (list.length === 1) { return first.given ? `${first.family}, ${first.given}` : first.family; }
  if (list.length === 2) { return `${first.family}, ${first.given}, and ${[second!.given, second!.family].filter(Boolean).join(" ")}`; }
  return `${first.family}, ${first.given}, et al`;
}

function mla(paper: CitedPaper): string {
  const authors = mlaAuthors(names(paper));
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push(`“${sentence(paper.title)}”`);
  const container: string[] = [];
  const venue = paper.journal ?? paper.publisher;
  if (venue) { container.push(venue); }
  if (paper.volume) { container.push(`vol. ${paper.volume}`); }
  if (paper.issue) { container.push(`no. ${paper.issue}`); }
  if (paper.year) { container.push(String(paper.year)); }
  if (paper.pages) { container.push(`pp. ${dashes(paper.pages)}`); }
  if (container.length) { parts.push(`${container.join(", ")}.`); }
  if (paper.doi) { parts.push(sentence(`https://doi.org/${paper.doi}`)); }
  return parts.join(" ");
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) { return items.join(""); }
  if (items.length === 2) { return `${items[0]} and ${items[1]}`; }
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function chicago(paper: CitedPaper): string {
  const formatted = names(paper).map((n, i) => (!n.given ? n.family : i === 0 ? `${n.family}, ${n.given}` : `${n.given} ${n.family}`));
  // Chicago 17 author-date lists up to ten authors; with more, the first seven and "et al."
  const authors = formatted.length > 10 ? `${formatted.slice(0, 7).join(", ")}, et al` : joinWithAnd(formatted);
  const parts: string[] = [];
  if (authors) { parts.push(sentence(authors)); }
  parts.push(sentence(String(paper.year ?? "n.d.")), `“${sentence(paper.title)}”`);
  const venue = paper.journal ?? paper.publisher;
  if (venue) {
    let source = venue;
    if (paper.volume) { source += ` ${paper.volume}${paper.issue ? ` (${paper.issue})` : ""}`; }
    if (paper.pages) { source += `: ${dashes(paper.pages)}`; }
    parts.push(`${source}.`);
  }
  const link = derivePaperUrl(paper);
  if (link) { parts.push(sentence(link)); }
  return parts.join(" ");
}

// ---- venue line ----

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

// ---- labshelf: links ----

export interface ParsedPaperLink {
  readonly citeKey: string;
  /** 1-based page, absent when the link names only the paper. */
  readonly page?: number;
}

/** Where a link sits in a text, as UTF-16 offsets; `end` is exclusive. */
export interface PaperLinkMatch {
  readonly start: number;
  readonly end: number;
  readonly link: ParsedPaperLink;
}

const LINK = /(?<![A-Za-z0-9_+])(?:web\+)?labshelf:([A-Za-z0-9_:.-]+)(?:#p(\d+))?/g;
const TRAILING_PUNCTUATION = /[.:-]+$/;

export function formatPaperLink(link: ParsedPaperLink): string {
  return link.page === undefined ? `labshelf:${link.citeKey}` : `labshelf:${link.citeKey}#p${link.page}`;
}

/** Reads one whole link, also in its web+labshelf: form and percent-encoded, as a protocol handler receives it. */
export function parsePaperLink(text: string): ParsedPaperLink | undefined {
  const decoded = decodeOnce(text.trim());
  if (decoded === undefined) { return undefined; }
  const [match] = findPaperLinkMatches(decoded);
  return match !== undefined && match.start === 0 && match.end === decoded.length ? match.link : undefined;
}

/** Finds every link in free text: a comment, a Markdown file, a commit message. */
export function findPaperLinkMatches(text: string): PaperLinkMatch[] {
  if (!text.includes("labshelf:")) { return []; }
  const matches: PaperLinkMatch[] = [];
  for (const found of text.matchAll(LINK)) {
    const [whole, rawKey = "", rawPage] = found;
    // TRAP: a link that ends a sentence ("see labshelf:vaswani2017.") must not swallow the full stop.
    const citeKey = rawPage === undefined ? rawKey.replace(TRAILING_PUNCTUATION, "") : rawKey;
    if (citeKey === "") { continue; }
    const page = rawPage === undefined ? undefined : Number(rawPage);
    if (page !== undefined && !(Number.isSafeInteger(page) && page >= 1)) { continue; }
    const end = found.index + whole.length - (rawKey.length - citeKey.length);
    matches.push({ start: found.index, end, link: page === undefined ? { citeKey } : { citeKey, page } });
  }
  return matches;
}

function decodeOnce(text: string): string | undefined {
  if (!text.includes("%")) { return text; }
  try { return decodeURIComponent(text); } catch { return undefined; }
}

// ---- file size ----

/** @returns the size text, rounded for display */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  const kb = Math.round(bytes / 1024);
  if (kb < 1024) { return `${kb} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---- title match key ----

export function normalizeTitleForMatch(title: string): string {
  return normalizeText(title)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
