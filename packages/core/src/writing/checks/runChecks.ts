/** Runs every pre-submission rule over a built PDF's facts and its project's sources, and defines what the check reports. */
// CONTRACT: documents/contracts/library-format.md#labshelfyaml
import type { CheckSettings } from "../project/index.js";
import { deriveCountedPages, derivePaperBody, type PaperBody, type PdfFacts } from "./pdfFacts.js";

// --- Report types ---

export type CheckRule = "pages" | "anonymity" | "fonts" | "images" | "references";

/** A whole-document finding has no page; a source location is preferred whenever the text can be traced to a line. */
export type CheckPosition =
  | { kind: "pdf"; page?: number | undefined }
  | { kind: "source"; file: string; line: number };

export interface CheckProblem {
  rule: CheckRule;
  severity: "error" | "warning";
  message: string;
  location: CheckPosition;
}

/** A project source file, split into lines. */
export interface CheckSource {
  file: string;
  lines: string[];
}

// --- Anonymity ---

/** TRAP: a Typst `//` comment must not swallow the `//` of a URL, which Typst reads as a link. */
const TYPST_COMMENT = /(^|[^:])\/\/.*$/;
const LATEX_COMMENT = /(^|[^\\])%.*$/;

function withoutComment(line: string, file: string): string {
  return line.replace(file.endsWith(".typ") ? TYPST_COMMENT : LATEX_COMMENT, "$1");
}

/** The first source line whose text outside comments matches; `pattern` must not be global, so `test` keeps no state. */
function locateInSources(pattern: RegExp, sources: CheckSource[]): { file: string; line: number } | undefined {
  for (const source of sources) {
    const index = source.lines.findIndex((line) => pattern.test(withoutComment(line, source.file)));
    if (index >= 0) { return { file: source.file, line: index + 1 }; }
  }
  return undefined;
}

interface AnonymityInput {
  facts: PdfFacts;
  body: PaperBody;
  /** Author names from labshelf.yaml and the git user. */
  names: string[];
  sources: CheckSource[];
}

const INFO_FIELDS = ["Author", "Title", "Subject", "Keywords"];
const SELF_REFERENCES = [
  /\bour (?:own |)(?:previous|prior|earlier|past) (?:work|paper|papers|study|studies|results|method|approach)\b/i,
  /\bwe (?:have )?(?:previously|earlier) (?:showed|shown|proposed|introduced|presented|reported|published)\b/i,
  /\bin our (?:[A-Z]\w+ )?\d{4} (?:paper|work)\b/i,
];
const PERSONAL_LINKS = [
  /\b(?:github\.com|gitlab\.com|bitbucket\.org|huggingface\.co|sites\.google\.com)\/[\w.-]+(?:\/[\w.-]+)?/i,
  /\b[\w-]+\.github\.io\b/i,
  /https?:\/\/\S*\/~[\w.-]+/i,
];

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Name parts may be split by any spacing, a LaTeX `~` included, and never match inside a longer word. */
function namePattern(name: string): RegExp {
  return new RegExp(`(?<!\\p{L})${name.trim().split(/\s+/).map(escape).join("[\\s~]+")}(?!\\p{L})`, "iu");
}

function sourceLocation(match: string, page: number, sources: CheckSource[]): CheckPosition {
  const found = locateInSources(new RegExp(escape(match).replace(/\s+/g, "[\\s~]+"), "i"), sources);
  return found === undefined ? { kind: "pdf", page } : { kind: "source", ...found };
}

/** One finding per pattern and page, at the first match. */
function textFindings(pages: string[][], patterns: RegExp[], sources: CheckSource[], describe: (match: string, page: number) => Omit<CheckProblem, "location">): CheckProblem[] {
  const findings: CheckProblem[] = [];
  for (const [index, lines] of pages.entries()) {
    const text = lines.join("\n");
    for (const pattern of patterns) {
      const match = pattern.exec(text)?.[0];
      if (match !== undefined) { findings.push({ ...describe(match, index + 1), location: sourceLocation(match, index + 1, sources) }); }
    }
  }
  return findings;
}

function metadataFindings(info: Record<string, string>, names: RegExp[]): CheckProblem[] {
  const author = info["Author"]?.trim() ?? "";
  const leaking = INFO_FIELDS.filter((field) => field === "Author" ? author !== "" : names.some((name) => name.test(info[field] ?? "")));
  return leaking.map((field) => ({
    rule: "anonymity",
    severity: "error",
    message: `The PDF's ${field} field names an author${field === "Author" ? ` (${author})` : ""}; clear it, e.g. \\hypersetup{pdfauthor={}}.`,
    location: { kind: "pdf" },
  }));
}

/** Names in the reference list are allowed: venues ask for self-citations in the third person, not for none. */
function deriveAnonymityProblems({ facts, body, names, sources }: AnonymityInput): CheckProblem[] {
  const infoNames = (facts.info["Author"] ?? "").split(/\s*(?:,|;|\band\b)\s*/);
  const patterns = [...new Set([...names, ...infoNames].map((name) => name.trim()).filter((name) => name.length > 1))].map(namePattern);
  const allPages = facts.pages.map((page) => page.lines);
  return [
    ...metadataFindings(facts.info, patterns),
    ...textFindings(body.pages, patterns, sources, (match, page) => ({
      rule: "anonymity", severity: "error", message: `"${match}" appears on page ${page}; an anonymous submission must not name its authors.`,
    })),
    ...textFindings(body.pages, SELF_REFERENCES, sources, (match, page) => ({
      rule: "anonymity", severity: "warning", message: `"${match}" on page ${page} can reveal the authors; cite your own work in the third person.`,
    })),
    ...textFindings(allPages, PERSONAL_LINKS, sources, (match, page) => ({
      rule: "anonymity", severity: "warning", message: `"${match}" on page ${page} can reveal the authors; link an anonymized copy instead.`,
    })),
  ];
}

// --- PDF layout ---

const MIN_DPI = 300;
/** `??` is LaTeX's mark for an unresolved \ref; `[?]` and `(?)` mark unresolved citations in numeric and author-year styles. */
const UNRESOLVED = /\?\?|\[\?(?:,\s*\?)*\]|\(\?\)/g;

function derivePageLimitProblems(body: PaperBody, totalPages: number, settings: CheckSettings | undefined): CheckProblem[] {
  const limit = settings?.pages;
  const toEnd = settings?.countUpTo === "end";
  const { pages } = deriveCountedPages(body, totalPages, settings?.countUpTo ?? "references");
  if (limit === undefined || pages <= limit) { return []; }
  const counted = toEnd ? `${pages} pages` : body.headingFound ? `${pages} pages before the references` : `${pages} pages (no References heading found, so every page counts)`;
  return [{ rule: "pages", severity: "error", message: `The paper has ${counted}; the limit is ${limit}.`, location: { kind: "pdf" } }];
}

function deriveType3FontProblems(facts: PdfFacts): CheckProblem[] {
  const pages = facts.pages.flatMap((page, index) => (page.fonts.some((font) => font.type3) ? [index + 1] : []));
  if (pages.length === 0) { return []; }
  return [{
    rule: "fonts",
    severity: "warning",
    message: `Type 3 fonts on page${pages.length > 1 ? "s" : ""} ${pages.join(", ")}; many venues reject them. They usually come from a figure: in matplotlib set pdf.fonttype to 42.`,
    location: { kind: "pdf", page: pages[0] },
  }];
}

function deriveImageResolutionProblems(facts: PdfFacts): CheckProblem[] {
  return facts.pages.flatMap((page, index) =>
    page.images.flatMap((image) => {
      if (image.width <= 0 || image.height <= 0) { return []; }
      const dpi = Math.round(Math.min(image.pixelWidth / (image.width / 72), image.pixelHeight / (image.height / 72)));
      if (dpi >= MIN_DPI) { return []; }
      return [{
        rule: "images" as const,
        severity: "warning" as const,
        message: `A ${image.pixelWidth}×${image.pixelHeight} image on page ${index + 1} prints at ${dpi} dpi, under ${MIN_DPI}; export the figure as a vector PDF or at a higher resolution.`,
        location: { kind: "pdf" as const, page: index + 1 },
      }];
    }),
  );
}

function deriveUnresolvedReferenceProblems(facts: PdfFacts): CheckProblem[] {
  return facts.pages.flatMap((page, index) => {
    const count = page.lines.reduce((sum, line) => sum + (line.match(UNRESOLVED)?.length ?? 0), 0);
    if (count === 0) { return []; }
    return [{
      rule: "references" as const,
      severity: "error" as const,
      message: `${count} unresolved reference${count > 1 ? "s or citations" : " or citation"} (?? or [?]) on page ${index + 1}.`,
      location: { kind: "pdf" as const, page: index + 1 },
    }];
  });
}

// --- Running the rules ---

export interface CheckInput {
  facts: PdfFacts;
  sources: CheckSource[];
  /** The project's `check:` key; without it every rule but the page limit runs. */
  settings: CheckSettings | undefined;
  /** The git user's name, which an anonymous paper must not show either. */
  gitUser: string | undefined;
}

/** Errors first, then in PDF order, so the worst problems lead the list. */
export function runChecks({ facts, sources, settings, gitUser }: CheckInput): CheckProblem[] {
  const body = derivePaperBody(facts.pages.map((page) => page.lines));
  const names = [...(settings?.authors ?? []), ...(gitUser === undefined ? [] : [gitUser])];
  const findings = [
    ...derivePageLimitProblems(body, facts.pages.length, settings),
    ...(settings?.anonymous ?? true ? deriveAnonymityProblems({ facts, body, names, sources }) : []),
    ...deriveUnresolvedReferenceProblems(facts),
    ...deriveType3FontProblems(facts),
    ...deriveImageResolutionProblems(facts),
  ];
  const rank = (finding: CheckProblem): number => (finding.severity === "error" ? 0 : 1);
  return findings.map((finding, order) => ({ finding, order })).sort((a, b) => rank(a.finding) - rank(b.finding) || a.order - b.order).map(({ finding }) => finding);
}
