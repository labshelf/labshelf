/** Describes a template as the gallery lists it and derives what the gallery shows: the blank template of a new project, the filtered and ordered list, the engine problem of an entry, and the download counts. */

import type { FetchLike } from "../ports/index.js";
import type { ProjectFormat } from "../writing/project/index.js";
import type { TemplateFile } from "./communitySource.js";
import { isNewerVersion } from "./universeSource.js";
import type { ProjectTemplate, TemplateEngine, TemplateKind, TemplateManifest } from "./templateManifest/index.js";

export const TEMPLATE_SOURCES = ["community", "universe", "mine"] as const;
export type TemplateSourceId = (typeof TEMPLATE_SOURCES)[number];

export interface TemplateEntry extends TemplateManifest {
  source: TemplateSourceId;
  /** The package version, for Typst Universe templates. */
  version?: string;
  /** Paths relative to the template's files/ folder, when the source knows them without downloading. */
  files?: string[];
  /** Downloads over the past 365 days, when the source counts them. */
  downloads?: number;
}

const LATEX_SPECIALS: Record<string, string> = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", $: "\\$", "&": "\\&", "#": "\\#",
  "^": "\\textasciicircum{}", _: "\\_", "%": "\\%", "~": "\\textasciitilde{}",
};

function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#^_%~]/g, (char) => LATEX_SPECIALS[char]!);
}

function escapeTypstString(text: string): string {
  return text.replace(/["\\]/g, (char) => `\\${char}`);
}

// Neither template cites anything yet: a bibliography line pointing at a file that does not exist breaks the
// Typst build, so the line is added with the first citation.
function latexArticle(title: string): string {
  return [
    "\\documentclass{article}",
    "\\usepackage{hyperref}",
    "",
    `\\title{${escapeLatex(title)}}`,
    "\\author{}",
    "\\date{\\today}",
    "",
    "\\begin{document}",
    "\\maketitle",
    "",
    "\\section{Introduction}",
    "",
    "\\end{document}",
    "",
  ].join("\n");
}

function typstArticle(title: string): string {
  return [
    `#let title = "${escapeTypstString(title)}"`,
    "#set document(title: title)",
    "#set page(paper: \"a4\", numbering: \"1\")",
    "#set heading(numbering: \"1.\")",
    "",
    "#align(center, text(17pt, weight: \"bold\", title))",
    "",
    "= Introduction",
    "",
  ].join("\n");
}

/** The built-in template and its single main file for a new project. */
export function createBlankTemplate(format: ProjectFormat, title: string): { template: ProjectTemplate; files: TemplateFile[] } {
  const [main, text] = format === "latex" ? ["main.tex", latexArticle(title)] : ["main.typ", typstArticle(title)];
  return { template: { id: `blank-${format}`, format, main }, files: [{ path: main, bytes: new TextEncoder().encode(text) }] };
}

export type TemplateSort = "most-used" | "name";

/** A new array in the given order; ties and entries without a count keep their original relative order. */
export function orderTemplates<T extends TemplateEntry>(entries: readonly T[], sort: TemplateSort): T[] {
  const sorted = [...entries];
  // Array.prototype.sort is stable, so a comparator that returns 0 keeps the input order.
  if (sort === "name") return sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return sorted.sort((a, b) => {
    if (a.downloads === undefined || b.downloads === undefined) return Number(a.downloads === undefined) - Number(b.downloads === undefined);
    return b.downloads - a.downloads;
  });
}

export interface TemplateFilter {
  source?: TemplateSourceId;
  /** Empty means every format. */
  formats?: readonly ProjectFormat[];
  category?: TemplateKind;
  query?: string;
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchesWords(entry: TemplateEntry, words: readonly string[]): boolean {
  const haystack = fold([entry.id, entry.name, entry.description, ...entry.authors].join("\n"));
  return words.every((word) => haystack.includes(word));
}

/** The entries that satisfy every given facet and contain every word of the query, in their original order. */
export function deriveFilteredTemplates<T extends TemplateEntry>(entries: readonly T[], filter: TemplateFilter): T[] {
  const words = fold(filter.query ?? "").split(/\s+/).filter((word) => word !== "");
  const formats = filter.formats ?? [];
  return entries.filter((entry) =>
    (filter.source === undefined || entry.source === filter.source)
    && (formats.length === 0 || formats.includes(entry.format))
    && (filter.category === undefined || entry.category === filter.category)
    && matchesWords(entry, words));
}

export interface AvailableEngines {
  engines: ReadonlySet<TemplateEngine>;
  typstVersion: string;
}

export function deriveEngineProblem(entry: TemplateEntry, available: AvailableEngines): string | undefined {
  if (!available.engines.has(entry.engine)) { return `Needs ${entry.engine}, which is not available on this machine`; }
  if (entry.engine === "typst" && entry.compiler !== undefined && isNewerVersion(entry.compiler, available.typstVersion)) {
    return `Needs Typst ${entry.compiler}; this machine has ${available.typstVersion}`;
  }
  return undefined;
}

const STATS_URL = "https://data.jsdelivr.com/v1/stats/packages/gh/labshelf/labshelf-templates";
const MAX_PAGE = 100;

interface HitRow {
  hits: { total: number };
}

/** Reads every page of a jsDelivr stats list; throws with the URL and status on a non-OK response. */
async function fetchAllPages<T>(base: string, fetch: FetchLike, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGE; page++) {
    const url = `${base}?period=year&limit=100&page=${page}`;
    const response = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) throw new Error(`jsDelivr request failed: ${url} ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error(`jsDelivr request returned a non-list body: ${url}`);
    rows.push(...(body as T[]));
    const totalPages = Number(response.headers.get("x-total-pages"));
    if (!Number.isInteger(totalPages)) throw new Error(`jsDelivr response has no x-total-pages header: ${url}`);
    if (page >= totalPages) return rows;
  }
  throw new Error(`jsDelivr list exceeds ${MAX_PAGE} pages: ${base}`);
}

/** Download counts keyed by template id, sorted by id; a template without hits maps to 0. */
export async function countDownloads(
  templates: readonly { id: string; main: string }[],
  fetch: FetchLike,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const idByPath = new Map(templates.map((t) => [`/templates/${t.id}/files/${t.main}`, t.id]));
  const counts = new Map(templates.map((t) => [t.id, 0]));
  const versions = await fetchAllPages<HitRow & { version: string }>(`${STATS_URL}/versions`, fetch, signal);
  for (const { version, hits } of versions) {
    // Versions without hits have no file rows to read.
    if (hits.total === 0) continue;
    const files = await fetchAllPages<HitRow & { name: string }>(`${STATS_URL}@${version}/files`, fetch, signal);
    for (const { name, hits: fileHits } of files) {
      const id = idByPath.get(name);
      if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + fileHits.total);
    }
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
