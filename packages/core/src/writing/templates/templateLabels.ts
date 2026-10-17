// Names the template sources, formats, engines and categories the way the gallery shows them, and composes a template's by-line and meta line.
import type { ProjectFormat } from "../project/index.js";
import type { TemplateEntry, TemplateSourceId } from "./templateEntry.js";
import type { TemplateCategory, TemplateEngine } from "./manifest/index.js";

export const SOURCE_LABELS: Record<TemplateSourceId, string> = {
  community: "LabShelf Community",
  universe: "Typst Universe",
  mine: "My templates",
};

export const FORMAT_LABELS: Record<ProjectFormat, string> = { latex: "LaTeX", typst: "Typst" };

export const ENGINE_LABELS: Record<TemplateEngine, string> = {
  pdflatex: "pdfLaTeX",
  lualatex: "LuaLaTeX",
  xelatex: "XeLaTeX",
  tectonic: "Tectonic",
  typst: "Typst",
};

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  article: "Article",
  thesis: "Thesis",
  poster: "Poster",
  slides: "Slides",
  cv: "CV",
  other: "Other",
};

/** "Ada, Bo · LabShelf Community": who wrote the template and where it comes from. */
export function templateByLine(entry: TemplateEntry): string {
  return [entry.authors.join(", "), SOURCE_LABELS[entry.source]].filter((part) => part !== "").join(" · ");
}

/** The engine's label, or undefined when it only repeats the format's ("Typst" format on the Typst engine). */
export function distinctEngineLabel(entry: TemplateEntry): string | undefined {
  const engine = ENGINE_LABELS[entry.engine];
  return engine === FORMAT_LABELS[entry.format] ? undefined : engine;
}

/** "LaTeX · pdfLaTeX · Article". */
export function templateMetaLine(entry: TemplateEntry): string {
  return [FORMAT_LABELS[entry.format], distinctEngineLabel(entry), CATEGORY_LABELS[entry.category]]
    .filter((part) => part !== undefined)
    .join(" · ");
}

/** "1.2k": a count with at most one decimal, in thousands (k) or millions (M). */
function compactCount(count: number): string {
  if (count < 1000) return String(count);
  const thousands = Math.round(count / 100) / 10;
  return thousands < 1000 ? `${thousands}k` : `${Math.round(count / 100_000) / 10}M`;
}

/** "1.2k": the template's use count, or undefined when the source has none. */
export function templateUsesCount(entry: TemplateEntry): string | undefined {
  return entry.downloads === undefined ? undefined : compactCount(entry.downloads);
}

/** "1.2k uses" or "1 use": the use count with its unit, or undefined when the source has none. */
export function templateUsesLabel(entry: TemplateEntry): string | undefined {
  const count = templateUsesCount(entry);
  return count === undefined ? undefined : `${count} ${entry.downloads === 1 ? "use" : "uses"}`;
}
