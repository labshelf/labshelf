// The templates of a new deck: a registry of talk and poster templates per format built from poster section templates,
// the validated creation choice of the gallery and the one scaffold that turns a choice into the files of the new deck folder.
import { escapeAttribute } from "./deckCharts.js";
import type { DeckKit } from "./deckKit.js";
import { isDeckName, scaffoldDeck, scaffoldPosterDeck } from "./deckProject.js";
import { deckCanvasPx, isDeckSizeAllowed, listDeckSizePresets, sameSize, type DeckKind, type DeckSize, type DeckSizePreset } from "./deckSizes.js";
import { setThemeStyle } from "./deckStyleCss.js";
import { px } from "./deckStyle.js";
import { setSourceDeckStyle } from "./deckStyleSource.js";
import { DECK_STYLE_TOKENS, normaliseDeckStyle, validateDeckStyle, type DeckStyle } from "./deckStyleTokens.js";
import { scaffoldBlankSourceTalk, scaffoldSourceDeck, scaffoldSourcePoster, type LatexPosterPaper, type SourceDeckShape } from "./sourceDeckScaffold.js";
import { sourceDeckMainFile, type SourceDeckFormat } from "./sourceDecks.js";

export type DeckTemplateFormat = "html" | SourceDeckFormat;

export interface PosterSectionTemplate { id: string; title: string; text: string }

export interface DeckPosterLayout { columns: number[]; headerHeight: number; typeScale: number; sections: Array<{ section: string; column: number; weight?: number; takeaway?: boolean }> }

export interface DeckTemplate { id: string; name: string; description: string; kind: DeckKind; formats: DeckTemplateFormat[]; poster?: DeckPosterLayout }

export interface DeckTemplateChoice { kind: DeckKind; format: DeckTemplateFormat; template: string; title: string; size: DeckSize; style: DeckStyle | null }

/** What a host gives the template gallery: the kind to start on, the formats it can create and the library's Kits. */
export interface DeckTemplateGalleryInit { kind?: DeckKind; formats: DeckTemplateFormat[]; kits: DeckKit[] }

/** The sections a poster template is built from, in order. */
export const POSTER_SECTION_TEMPLATES: readonly PosterSectionTemplate[] = [
  { id: "introduction", title: "Introduction", text: "What the problem is and why it matters." },
  { id: "methods", title: "Methods", text: "How you studied it, in a few short steps." },
  { id: "results", title: "Results", text: "What you found, with the numbers that matter." },
  { id: "conclusion", title: "Conclusion", text: "What the results mean and what comes next." },
  { id: "references", title: "References", text: "The few sources a reader needs to follow up." },
  { id: "acknowledgements", title: "Acknowledgements", text: "Who helped with the work and who funded it." },
  { id: "contact", title: "Contact", text: "Your name, your email and where to find the paper." },
  { id: "main-finding", title: "Main finding", text: "The main finding in one plain sentence that a passer-by can read." },
  { id: "key-figure", title: "Key figure", text: "The one figure that shows the main finding." },
];

const FORMATS: readonly DeckTemplateFormat[] = ["html", "latex", "typst"];

const TEMPLATES: readonly DeckTemplate[] = [
  { id: "blank", name: "Blank", description: "A title slide and nothing else.", kind: "talk", formats: [...FORMATS] },
  { id: "generic", name: "Generic", description: "A title slide followed by Motivation, Results and Conclusion slides.", kind: "talk", formats: [...FORMATS] },
  {
    id: "blank", name: "Blank", description: "A header band and one full-width section.", kind: "poster", formats: [...FORMATS],
    poster: { columns: [1], headerHeight: 0.12, typeScale: 1, sections: [{ section: "introduction", column: 0 }] },
  },
  {
    id: "generic", name: "Generic", description: "Three equal columns with Introduction, Methods and Results.", kind: "poster", formats: [...FORMATS],
    poster: { columns: [1, 1, 1], headerHeight: 0.12, typeScale: 1, sections: [{ section: "introduction", column: 0 }, { section: "methods", column: 1 }, { section: "results", column: 2 }] },
  },
  {
    id: "better-poster", name: "Better Poster", description: "A wide centre column with the main finding in one large plain-language sentence, between narrow side columns.", kind: "poster", formats: [...FORMATS],
    poster: {
      columns: [1, 2, 1], headerHeight: 0.08, typeScale: 1,
      sections: [
        { section: "introduction", column: 0 }, { section: "methods", column: 0 }, { section: "results", column: 0 },
        { section: "main-finding", column: 1, takeaway: true },
        { section: "key-figure", column: 2 }, { section: "references", column: 2 }, { section: "contact", column: 2 },
      ],
    },
  },
  {
    id: "billboard", name: "Billboard", description: "A large header and large type, with one big key result beside a narrow column.", kind: "poster", formats: [...FORMATS],
    poster: {
      columns: [2, 1], headerHeight: 0.16, typeScale: 1.25,
      sections: [
        { section: "main-finding", column: 0, weight: 2, takeaway: true }, { section: "key-figure", column: 0 },
        { section: "methods", column: 1 }, { section: "results", column: 1 }, { section: "contact", column: 1 },
      ],
    },
  },
];

const copyTemplate = (template: DeckTemplate): DeckTemplate => ({
  ...template,
  formats: [...template.formats],
  ...(template.poster ? { poster: { ...template.poster, columns: [...template.poster.columns], sections: template.poster.sections.map((section) => ({ ...section })) } } : {}),
});

/** The templates of a kind in a format, Blank first; fresh copies each call, [] for an unknown kind or format. */
export function listDeckTemplates(kind: DeckKind, format: DeckTemplateFormat): DeckTemplate[] {
  return TEMPLATES.filter((template) => template.kind === kind && template.formats.includes(format)).map(copyTemplate);
}

const LATEX_POSTER_PRESETS = ["a0-portrait", "a0-landscape", "a1-portrait", "a1-landscape", "a2-portrait", "a2-landscape"];
const SOURCE_TALK_PRESETS = ["talk-16-9", "talk-4-3"];

/** The sizes a new deck offers: every preset of the kind for HTML, 16:9 and 4:3 for source talks, A0 to A2 for LaTeX posters, every poster preset for Typst. */
export function listTemplateSizes(kind: DeckKind, format: DeckTemplateFormat): DeckSizePreset[] {
  const presets = listDeckSizePresets(kind);
  if (format === "html") return presets;
  if (kind === "talk") return presets.filter((preset) => SOURCE_TALK_PRESETS.includes(preset.id));
  return format === "latex" ? presets.filter((preset) => LATEX_POSTER_PRESETS.includes(preset.id)) : presets;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const MAX_TITLE = 200;

function sizeAllowed(kind: DeckKind, format: DeckTemplateFormat, size: DeckSize): boolean {
  if (!isDeckSizeAllowed(kind, size)) return false;
  return format === "html" || listTemplateSizes(kind, format).some((preset) => sameSize(preset.size, size));
}

function parseSize(raw: unknown): DeckSize | null {
  if (!isRecord(raw)) return null;
  const { w, h, unit } = raw;
  if (typeof w !== "number" || typeof h !== "number" || (unit !== "px" && unit !== "mm" && unit !== "in")) return null;
  return { w, h, unit };
}

function parseStyle(raw: unknown): DeckStyle | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;
  const style = Object.fromEntries(DECK_STYLE_TOKENS.map((token) => [token, raw[token]])) as unknown as DeckStyle;
  return validateDeckStyle(style).length > 0 ? undefined : normaliseDeckStyle(style);
}

/** The creation choice of the gallery, validated and normalised (title trimmed, style normalised); null for anything else. Never throws. */
export function parseDeckTemplateChoice(raw: unknown): DeckTemplateChoice | null {
  try {
    if (!isRecord(raw)) return null;
    const { kind, format, template, title } = raw;
    if (kind !== "talk" && kind !== "poster") return null;
    if (typeof format !== "string" || !FORMATS.includes(format as DeckTemplateFormat)) return null;
    const deckFormat = format as DeckTemplateFormat;
    if (typeof template !== "string" || !listDeckTemplates(kind, deckFormat).some((entry) => entry.id === template)) return null;
    if (typeof title !== "string") return null;
    const trimmed = title.trim();
    if (trimmed === "" || trimmed.length > MAX_TITLE) return null;
    const size = parseSize(raw.size);
    if (!size || !sizeAllowed(kind, deckFormat, size)) return null;
    const style = parseStyle(raw.style);
    if (style === undefined) return null;
    return { kind, format: deckFormat, template, title: trimmed, size, style };
  } catch {
    return null;
  }
}

// ---- the scaffold ----

const sectionTemplate = (id: string): PosterSectionTemplate => POSTER_SECTION_TEMPLATES.find((section) => section.id === id)!;

const TALK_SLIDES: ReadonlyArray<readonly [string, string]> = [
  ["Motivation", "Why the question matters, in one or two sentences."],
  ["Results", "What you found, with one figure or number per slide."],
  ["Conclusion", "The take-home message and what comes next."],
];

const rectStyle = (left: number, top: number, width: number, height: number): string =>
  `left: ${px(left)}; top: ${px(top)}; width: ${px(width)}; height: ${px(height)};`;

/** The Generic talk's slides after the title slide: a heading block and a text block each, with empty notes. */
function talkSlides(size: DeckSize): string {
  const { width, height } = deckCanvasPx(size);
  const margin = Math.min(width, height) * 0.05;
  const inner = width - 2 * margin;
  const textTop = margin + height * 0.2;
  return TALK_SLIDES.map(([title, text]) => {
    const id = title.toLowerCase();
    return [
      "<section data-slide>",
      `<div data-block="${id}-heading" style="${rectStyle(margin, margin, inner, height * 0.15)}"><h2>${escapeAttribute(title)}</h2></div>`,
      `<div data-block="${id}-text" style="${rectStyle(margin, textTop, inner, height - textTop - margin)}"><p>${escapeAttribute(text)}</p></div>`,
      "<aside data-notes></aside>",
      "</section>",
      "",
    ].join("\n");
  }).join("");
}

function htmlFiles(choice: DeckTemplateChoice, template: DeckTemplate, name: string): { html: string; theme: string } {
  if (choice.kind === "talk") {
    const deck = scaffoldDeck("talk", name, choice.size);
    if (template.id === "blank") return deck;
    const at = deck.html.lastIndexOf("</body>");
    return { html: deck.html.slice(0, at) + talkSlides(choice.size) + deck.html.slice(at), theme: deck.theme };
  }
  if (template.id === "generic") return scaffoldDeck("poster", name, choice.size);
  const layout = template.poster!;
  return scaffoldPosterDeck(name, choice.size, {
    columns: layout.columns,
    headerHeight: layout.headerHeight,
    typeScale: layout.typeScale,
    sections: layout.sections.map(({ section, ...rest }) => ({ ...sectionTemplate(section), ...rest })),
  });
}

/** The shape of a source deck for an allowed size: 4:3 or 16:9 for a talk, the A paper and orientation for a LaTeX poster. */
function sourceShape(choice: DeckTemplateChoice): SourceDeckShape {
  const { size } = choice;
  if (choice.kind === "talk") return { kind: "talk", aspect: Math.abs(size.w / size.h - 4 / 3) <= 0.01 ? "4:3" : "16:9" };
  if (choice.format !== "latex") return { kind: "poster", size };
  const preset = listTemplateSizes("poster", "latex").find((entry) => sameSize(entry.size, size))!;
  return { kind: "poster", size, paper: preset.id.slice(0, 2) as LatexPosterPaper, landscape: size.w > size.h };
}

function sourceText(format: SourceDeckFormat, choice: DeckTemplateChoice, template: DeckTemplate): string {
  const shape = sourceShape(choice);
  if (shape.kind === "talk") return template.id === "blank" ? scaffoldBlankSourceTalk(format, choice.title, shape.aspect) : scaffoldSourceDeck(format, choice.title, shape);
  if (template.id === "generic") return scaffoldSourceDeck(format, choice.title, shape);
  const layout = template.poster!;
  return scaffoldSourcePoster(format, choice.title, shape, {
    columns: layout.columns,
    typeScale: layout.typeScale,
    sections: layout.sections.map(({ section, column, takeaway }) => ({ ...sectionTemplate(section), column, ...(takeaway === undefined ? {} : { takeaway }) })),
  });
}

/** The files of a new deck folder for a choice: deck.html and theme.css for HTML, the main file for LaTeX and Typst, with the style written as the labshelf:style block when given. Throws RangeError for a bad name, an unknown template or a size the format does not offer. */
export function scaffoldDeckFromTemplate(choice: DeckTemplateChoice, name: string): Array<{ path: string; text: string }> {
  if (!isDeckName(name)) throw new RangeError(`"${name}" is not a valid deck name`);
  const template = TEMPLATES.find((entry) => entry.kind === choice.kind && entry.id === choice.template && entry.formats.includes(choice.format));
  if (!template) throw new RangeError(`"${choice.template}" is not a ${choice.kind} template for ${choice.format}`);
  if (!sizeAllowed(choice.kind, choice.format, choice.size)) throw new RangeError(`The size is not offered for a ${choice.format} ${choice.kind}`);
  if (choice.format === "html") {
    const deck = htmlFiles(choice, template, name);
    const theme = choice.style ? setThemeStyle(deck.theme, choice.style) : deck.theme;
    if (theme === null) throw new RangeError("The style cannot be applied");
    return [{ path: "deck.html", text: deck.html }, { path: "theme.css", text: theme }];
  }
  const format = choice.format;
  const base = sourceText(format, choice, template);
  const text = choice.style ? setSourceDeckStyle(format, base, choice.style)?.text ?? null : base;
  if (text === null) throw new RangeError("The style cannot be applied");
  return [{ path: sourceDeckMainFile(format), text }];
}
