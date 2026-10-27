// Names the template sources, formats, engines, categories and pre-publish checks the way the gallery and the Publish screen show them, and declares the shapes of a publish check.
import type { ILogger } from "../ports/index.js";
import type { ProjectFormat } from "../writing/project/index.js";
import type { TemplateEntry, TemplateSourceId } from "./templateCatalog.js";
import type { TemplateEngine, TemplateKind, TemplateManifest } from "./templateManifest/index.js";

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
  typst: "Typst",
};

export const CATEGORY_LABELS: Record<TemplateKind, string> = {
  article: "Article",
  thesis: "Thesis",
  poster: "Poster",
  slides: "Slides",
  cv: "CV",
  other: "Other",
};

/** "Ada, Bo · LabShelf Community": who wrote the template and where it comes from. */
export function formatTemplateByLine(entry: TemplateEntry): string {
  return [entry.authors.join(", "), SOURCE_LABELS[entry.source]].filter((part) => part !== "").join(" · ");
}

/** The engine's label, or undefined when it only repeats the format's ("Typst" format on the Typst engine). */
export function formatDistinctEngineLabel(entry: TemplateEntry): string | undefined {
  const engine = ENGINE_LABELS[entry.engine];
  return engine === FORMAT_LABELS[entry.format] ? undefined : engine;
}

/** "LaTeX · pdfLaTeX · Article". */
export function formatTemplateMetaLine(entry: TemplateEntry): string {
  return [FORMAT_LABELS[entry.format], formatDistinctEngineLabel(entry), CATEGORY_LABELS[entry.category]]
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
export function formatTemplateUsesCount(entry: TemplateEntry): string | undefined {
  return entry.downloads === undefined ? undefined : compactCount(entry.downloads);
}

/** "1.2k uses" or "1 use": the use count with its unit, or undefined when the source has none. */
export function formatTemplateUsesLabel(entry: TemplateEntry): string | undefined {
  const count = formatTemplateUsesCount(entry);
  return count === undefined ? undefined : `${count} ${entry.downloads === 1 ? "use" : "uses"}`;
}

export const PUBLISH_CHECK_IDS = ["manifest", "license", "paths", "latexmkrc", "sizes", "build", "thumbnail"] as const;

export type PublishCheckId = (typeof PUBLISH_CHECK_IDS)[number];

const FIXED_LABELS: Record<Exclude<PublishCheckId, "build">, string> = {
  manifest: "Name and description set",
  license: "License set",
  paths: "All files inside the project",
  latexmkrc: "No latexmkrc",
  sizes: "File sizes within limits",
  thumbnail: "Thumbnail compiled",
};

/** @param formatEngineLabel the engine's display name ("pdfLaTeX"), shown in the build row. */
export function publishCheckLabel(id: PublishCheckId, engineLabel: string): string {
  return id === "build" ? `Builds with ${engineLabel}` : FIXED_LABELS[id];
}


export interface PublishFile {
  /** Relative to the template's folder in the catalog. */
  path: string;
  bytes: Uint8Array;
}

export interface PublishCheck {
  id: PublishCheckId;
  ok: boolean;
  /** Why the check failed; absent when it passed. */
  message?: string;
}

/** `files`, `thumbnail` and `sample` are present only when every check passed. */
export interface PublishCheckReport {
  checks: PublishCheck[];
  ok: boolean;
  files?: PublishFile[];
  thumbnail?: Uint8Array;
  sample?: Uint8Array;
}

export type PublishBuildResult = { ok: true; pdf: Uint8Array } | { ok: false; problems: string[] };

export interface PublishCheckInput {
  projectFolder: string;
  manifest: TemplateManifest;
  /** Builds the project with its declared engine; never with shell escape. */
  buildPdf: () => Promise<PublishBuildResult>;
  /** Renders page 1 of the built PDF to a PNG. */
  renderThumbnail: (pdf: Uint8Array) => Promise<Uint8Array>;
  logger: ILogger;
}
