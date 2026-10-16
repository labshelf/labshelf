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
