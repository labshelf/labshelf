/** Finds what can reveal the authors of an anonymous submission: their names, self-references and personal links. */
import type { CheckFinding, CheckLocation, CheckSource, PdfFacts } from "./checkReport.js";
import type { PaperBody } from "./paperBody.js";

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

export interface AnonymityInput {
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

function sourceLocation(match: string, page: number, sources: CheckSource[]): CheckLocation {
  const found = locateInSources(new RegExp(escape(match).replace(/\s+/g, "[\\s~]+"), "i"), sources);
  return found === undefined ? { kind: "pdf", page } : { kind: "source", ...found };
}

/** One finding per pattern and page, at the first match. */
function textFindings(pages: string[][], patterns: RegExp[], sources: CheckSource[], describe: (match: string, page: number) => Omit<CheckFinding, "location">): CheckFinding[] {
  const findings: CheckFinding[] = [];
  for (const [index, lines] of pages.entries()) {
    const text = lines.join("\n");
    for (const pattern of patterns) {
      const match = pattern.exec(text)?.[0];
      if (match !== undefined) { findings.push({ ...describe(match, index + 1), location: sourceLocation(match, index + 1, sources) }); }
    }
  }
  return findings;
}

function metadataFindings(info: Record<string, string>, names: RegExp[]): CheckFinding[] {
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
export function anonymityFindings({ facts, body, names, sources }: AnonymityInput): CheckFinding[] {
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
