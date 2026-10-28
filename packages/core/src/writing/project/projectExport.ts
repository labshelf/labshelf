/** Prepares a project for leaving the app: the files of an exported zip, the arXiv bundle, the pandoc command line for Word, Markdown and HTML, and the install plan and report that bring the papers it lists into the library. */

import { derivePapersByCiteKey, parseBibEntries } from "../citations/index.js";
import { createDoiFinder, type ImportOutcome } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";
import { DEFAULT_BIBLIOGRAPHY, type ListedPaper, type ProjectFormat } from "./projectFile.js";

// --- Files of an export ---

// Compiler output and tool state; everything else in the folder is the user's.
const EXCLUDED = [
  /(^|\/)\.(?:git|svn|hg|labshelf)\//,
  /\.(?:aux|log|out|toc|fls|fdb_latexmk|bcf|blg|synctex\.gz|run\.xml)$/,
];

const ROOT_SOURCE = /^(.*)\.(?:tex|typ)$/;

/** Whether a path is compiler output or the state of a tool (VCS, LabShelf), which no copy of the project carries. */
export function isBuildOrToolPath(path: string): boolean {
  return EXCLUDED.some((rule) => rule.test(path));
}

/** The PDFs in `list` built from a root source next to them (`<root>.pdf` beside `<root>.tex|typ`). */
export function deriveBuiltPdfPaths(list: readonly string[]): Set<string> {
  return new Set(list.flatMap((path) => {
    const base = ROOT_SOURCE.exec(path)?.[1];
    return base === undefined ? [] : [`${base}.pdf`];
  }));
}

/** The paths (relative, POSIX) to export, in input order. */
export function deriveProjectFiles(list: string[]): string[] {
  const builtPdfs = deriveBuiltPdfPaths(list);
  return list.filter((path) => path !== DEFAULT_BIBLIOGRAPHY && !builtPdfs.has(path) && !isBuildOrToolPath(path));
}

// --- The arXiv bundle ---

export interface BibliographyText {
  path: string;
  text: string;
}

export interface ArxivBundle {
  /** Files copied as they are; the .bbl stays when the project has one. */
  files: string[];
  /** The user's .bib files with only cited entries; @string, @preamble and comments stay. */
  bibs: BibliographyText[];
}

// `end` is exclusive, so the slice [start, end) ends with the entry's closing delimiter.
function citedOnly(text: string, cited: ReadonlySet<string>): string {
  return parseBibEntries(text).filter((entry) => !cited.has(entry.key)).reduceRight(
    (kept, entry) => kept.slice(0, entry.start) + kept.slice(entry.end), text);
}

export function createArxivBundle(sources: string[], bibs: BibliographyText[], citedKeys: string[]): ArxivBundle {
  const user = bibs.filter((bib) => bib.path !== DEFAULT_BIBLIOGRAPHY);
  const rewritten = new Set(user.map((bib) => bib.path));
  const cited = new Set(citedKeys);
  return {
    files: deriveProjectFiles(sources).filter((path) => !rewritten.has(path)),
    bibs: user.map(({ path, text }) => ({ path, text: citedOnly(text, cited) })),
  };
}

// --- Pandoc ---

export type DocumentExport = "docx" | "markdown" | "html";

export const DOCUMENT_EXPORT_EXTENSIONS: Record<DocumentExport, string> = { docx: "docx", markdown: "md", html: "html" };

// GitHub Markdown keeps tables and math that pandoc's default Markdown writes in its own extensions.
const PANDOC_WRITERS: Record<DocumentExport, string> = { docx: "docx", markdown: "gfm", html: "html" };

/** The arguments after `pandoc`; `main` is relative to the folder pandoc runs in, so relative images resolve. */
export function createPandocArgs(format: ProjectFormat, main: string, target: DocumentExport, output: string): string[] {
  return [
    "--from", format, "--to", PANDOC_WRITERS[target],
    ...(target === "html" ? ["--standalone"] : []),
    "--output", output, main,
  ];
}

// --- Installing the papers a project lists ---

export type InstallEntry =
  | { kind: "present"; key: string }
  /** The library has no paper with this key, but one with the listed DOI, keyed `existingKey`. */
  | { kind: "other-key"; key: string; existingKey: string }
  | { kind: "no-doi"; key: string }
  /** The key becomes the paper's folder name, so it must be a plain name. */
  | { kind: "bad-key"; key: string }
  | { kind: "import"; key: string; doi: string };

// INVARIANT: a key that passes becomes a folder name inside the library; it can never name a path.
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9_.+-]*$/;

/** @returns one entry per listed paper, in the listed order; a key listed twice is planned once */
export function createInstallPlan(listed: readonly ListedPaper[], records: readonly PaperRecord[]): InstallEntry[] {
  const byKey = derivePapersByCiteKey(records);
  const byDoi = createDoiFinder(records);
  const keyOfId = new Map(records.map((record) => [record.id, record.citeKey]));
  const seen = new Set<string>();
  const plan: InstallEntry[] = [];
  for (const { key, doi } of listed) {
    if (seen.has(key)) { continue; }
    seen.add(key);
    if (!SAFE_KEY.test(key)) { plan.push({ kind: "bad-key", key }); continue; }
    if (byKey.has(key)) { plan.push({ kind: "present", key }); continue; }
    if (!doi) { plan.push({ kind: "no-doi", key }); continue; }
    const existingId = byDoi(doi);
    plan.push(existingId ? { kind: "other-key", key, existingKey: keyOfId.get(existingId) ?? existingId } : { kind: "import", key, doi });
  }
  return plan;
}

/** A planned entry and, for an `import` entry, what its import returned. */
export interface InstallResult {
  entry: InstallEntry;
  outcome?: ImportOutcome | undefined;
}

export interface InstallLine {
  level: "info" | "warn";
  text: string;
}

/** @returns the line for one paper, starting with its listed key */
export function describeInstall({ entry, outcome }: InstallResult): InstallLine {
  const { key } = entry;
  switch (entry.kind) {
    case "present": return { level: "info", text: `${key}: already in the library` };
    case "other-key": return { level: "warn", text: `${key}: in the library as ${entry.existingKey}; cite it by that key or rename the paper` };
    case "no-doi": return { level: "warn", text: `${key}: no DOI listed, cannot install` };
    case "bad-key": return { level: "warn", text: `${key}: not usable as a cite key (letters, digits and _ . + - only), cannot install` };
    case "import": break;
  }
  if (!outcome || outcome.status === "skipped") { return { level: "warn", text: `${key}: not installed` }; }
  if (outcome.status === "failed") { return { level: "warn", text: `${key}: failed: ${outcome.error}` }; }
  if (outcome.status === "duplicate") { return { level: "warn", text: `${key}: in the library as ${outcome.existingId}; cite it by that key or rename the paper` }; }
  const { record } = outcome;
  if (record.citeKey !== key) { return { level: "warn", text: `${key}: added as ${record.citeKey} because ${key} was taken` }; }
  return record.hasPdf
    ? { level: "info", text: `${key}: added` }
    : { level: "warn", text: `${key}: added without a PDF` };
}

const addedRecords = (results: readonly InstallResult[]): PaperRecord[] =>
  results.flatMap(({ outcome }) => (outcome?.status === "added" ? [outcome.record] : []));

/** The listed key resolves to a library paper once the install is done. */
export function isInstallResolved({ entry, outcome }: InstallResult): boolean {
  return entry.kind === "present" || (entry.kind === "import" && outcome?.status === "added" && outcome.record.citeKey === entry.key);
}

/** @returns the closing message; warn when a listed key does not resolve or a paper has no PDF */
export function describeInstallReport(results: readonly InstallResult[]): InstallLine {
  if (!results.length) { return { level: "info", text: "The project lists no papers" }; }
  const added = addedRecords(results);
  const withoutPdf = added.filter((record) => !record.hasPdf).length;
  const unresolved = results.filter((result) => !isInstallResolved(result)).length;
  const parts = [`${added.length} added`, `${results.filter(({ entry }) => entry.kind === "present").length} already in the library`];
  if (withoutPdf) { parts.push(`${withoutPdf} without a PDF`); }
  if (unresolved) { parts.push(`${unresolved} not resolved`); }
  return { level: withoutPdf || unresolved ? "warn" : "info", text: parts.join(", ") };
}
