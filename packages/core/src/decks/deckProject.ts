// Deck names, the deck folders of a project, a lexical deck path check and the scaffold of a new deck.
import { listDirEntries, type ProjectReadContext } from "../writing/project/index.js";
import { deckCanvasPx, formatDeckSize, isDeckSizeAllowed, type DeckKind, type DeckSize } from "./deckSizes.js";
import { escapeAttribute } from "./deckCharts.js";
import { reflowPoster, setPosterSettings } from "./posterSectionEdits.js";
import { POSTER_SETTING_PROPERTIES, readPosterSettings, round2 } from "./posterSections.js";
import { setThemeProperty } from "./themeCss.js";

export interface DeckEntry { kind: DeckKind; name: string; folder: string; file: string; theme: string }

export interface DeckPath { kind: DeckKind; name: string; folder: string; inner: string }

const DECK_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KINDS: readonly DeckKind[] = ["talk", "poster"];

/** The project folder that holds the decks of a kind. */
export function deckRootOf(kind: DeckKind): "talks" | "posters" {
  return kind === "talk" ? "talks" : "posters";
}

/** Lower-case letters, digits and hyphens, starting with a letter or digit, at most 64 characters. */
export function isDeckName(name: string): boolean {
  return DECK_NAME.test(name);
}

const MAX_FOLDER_NAME = 40;

/** A deck folder name for a title: ASCII letters and digits in lower case joined by single hyphens, at most 40 characters, "deck" when nothing is left. */
export function deckFolderName(title: string): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, MAX_FOLDER_NAME).replace(/-+$/, "");
  return slug || "deck";
}

/** The first of <base>, <base>-2, <base>-3… with no folder of that name under root. */
export async function findFreeDeckName(context: { fs: { exists(path: string): Promise<boolean> }; paths: { join(...parts: string[]): string } }, root: string, base: string): Promise<string> {
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base}-${n}`;
    if (!(await context.fs.exists(context.paths.join(root, name)))) return name;
  }
}

/** Lexical check of a project-relative path against `<root>/<name>[/<inner>]`; the node tools add the real-path check. */
export function checkDeckPath(relPath: string): DeckPath | null {
  if (relPath.includes("\\")) return null;
  const segments = relPath.split("/");
  if (segments.length < 2 || segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null;
  const [root, name] = segments as [string, string];
  const kind = KINDS.find((candidate) => deckRootOf(candidate) === root);
  if (kind === undefined || !isDeckName(name)) return null;
  return { kind, name, folder: `${root}/${name}`, inner: segments.slice(2).join("/") };
}

/** The decks of the project, talks then posters, each sorted by name; a subfolder counts only with a valid name and a deck.html. */
export async function listDecks(context: Pick<ProjectReadContext, "fs" | "paths">, projectFolder: string): Promise<DeckEntry[]> {
  const decks: DeckEntry[] = [];
  for (const kind of KINDS) {
    const root = deckRootOf(kind);
    const entries = await listDirEntries(context, context.paths.join(projectFolder, root));
    const names = entries.filter((entry) => entry.folder && isDeckName(entry.name)).map((entry) => entry.name).sort();
    for (const name of names) {
      const folder = `${root}/${name}`;
      const stat = await context.fs.stat(context.paths.join(projectFolder, root, name, "deck.html"));
      if (stat?.isFile === true) decks.push({ kind, name, folder, file: `${folder}/deck.html`, theme: `${folder}/theme.css` });
    }
  }
  return decks;
}

const DEFAULT_SIZE: Record<DeckKind, DeckSize> = {
  talk: { w: 1920, h: 1080, unit: "px" },
  poster: { w: 841, h: 1189, unit: "mm" },
};

/** Hundredths of px as a px length with at most 2 decimals. */
const px = (hundredths: number): string => `${hundredths / 100}px`;

/** The title block as a rect inside the canvas: a margin of 5% of the short side, the width between the margins and a fifth of the height. */
function titleStyle(size: DeckSize): string {
  const canvas = deckCanvasPx(size);
  const width = Math.round(canvas.width * 100);
  const height = Math.round(canvas.height * 100);
  const margin = Math.round(Math.min(width, height) * 0.05);
  const rect = { left: margin, top: margin, width: width - 2 * margin, height: Math.round(height * 0.2) };
  return `left: ${px(rect.left)}; top: ${px(rect.top)}; width: ${px(rect.width)}; height: ${px(rect.height)};`;
}

function themeOf(kind: DeckKind): string {
  const heading = kind === "talk" ? "64px" : "120px";
  return [
    ":root {",
    "  --deck-bg: #ffffff;",
    "  --deck-fg: #1a1a1a;",
    "  --deck-accent: #2563eb;",
    "  --deck-font: system-ui, sans-serif;",
    "}",
    "",
    "body {",
    "  margin: 0;",
    "  background: var(--deck-bg);",
    "  color: var(--deck-fg);",
    "  font-family: var(--deck-font);",
    "}",
    "",
    "h1 {",
    "  margin: 0;",
    `  font-size: ${heading};`,
    "  color: var(--deck-accent);",
    "}",
    "",
  ].join("\n");
}

/** The deck.html and theme.css of a new deck: one slide with a title block for a talk, a header band and three sections for a poster; the size defaults to 1920x1080px for a talk and 841x1189mm for a poster. */
export function scaffoldDeck(kind: DeckKind, name: string, size: DeckSize = DEFAULT_SIZE[kind]): { html: string; theme: string } {
  if (!isDeckName(name)) throw new RangeError(`"${name}" is not a valid deck name`);
  if (!isDeckSizeAllowed(kind, size)) throw new RangeError(`${formatDeckSize(size)} is not an allowed size for a ${kind}`);
  const html = [
    "<!doctype html>",
    `<html lang="en" data-deck="${kind}" data-deck-version="1" data-deck-size="${formatDeckSize(size)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${name}</title>`,
    '<link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    "<section data-slide>",
    ...(kind === "talk" ? [`<div data-block="title" style="${titleStyle(size)}">`, `<h1>${name}</h1>`, "</div>"] : POSTER_BLOCKS(name)),
    ...(kind === "talk" ? ["<aside data-notes></aside>"] : []),
    "</section>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
  if (kind === "talk") return { html, theme: themeOf(kind) };
  const reflowed = reflowPoster(html, posterTheme(size));
  if (!reflowed.ok) throw new RangeError(reflowed.error);
  return { html: reflowed.html, theme: reflowed.theme };
}

/** One section of a new poster: its block id, title, text and column, a weight only when given; a takeaway shows its text large without a heading. */
export interface PosterScaffoldSection { id: string; title: string; text: string; column: number; weight?: number; takeaway?: boolean }

/** The sections and Poster Settings of a new poster; headerHeight is the fraction of the canvas height. */
export interface PosterScaffold { sections: PosterScaffoldSection[]; columns: number[]; headerHeight: number; typeScale: number }

/** The theme rule of a takeaway section's large sentence. */
export const POSTER_TAKEAWAY_RULE = ".poster-takeaway { font-size: var(--poster-font-title, 96px); font-weight: 700; line-height: 1.15; }";

const scaffoldSectionLines = (section: PosterScaffoldSection): string[] => [
  `<div data-block="${section.id}" data-poster="section" data-column="${section.column}"${section.weight === undefined ? "" : ` data-weight="${section.weight}"`}>`,
  section.takeaway === true ? `<p class="poster-takeaway">${escapeAttribute(section.text)}</p>` : `<h2>${escapeAttribute(section.title)}</h2><p>${escapeAttribute(section.text)}</p>`,
  "</div>",
];

/** The deck.html and theme.css of a new sectioned poster: the header band and the given sections, the Poster Settings written with the columns, header height and type scale, then reflowed; a takeaway adds POSTER_TAKEAWAY_RULE to the theme. */
export function scaffoldPosterDeck(name: string, size: DeckSize, poster: PosterScaffold): { html: string; theme: string } {
  if (!isDeckName(name)) throw new RangeError(`"${name}" is not a valid deck name`);
  if (!isDeckSizeAllowed("poster", size)) throw new RangeError(`${formatDeckSize(size)} is not an allowed size for a poster`);
  const html = [
    "<!doctype html>",
    `<html lang="en" data-deck="poster" data-deck-version="1" data-deck-size="${formatDeckSize(size)}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${name}</title>`,
    '<link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    "<section data-slide>",
    ...posterHeader(name),
    ...poster.sections.flatMap(scaffoldSectionLines),
    "</section>",
    "</body>",
    "</html>",
    "",
  ].join("\n");
  const base = posterTheme(size);
  const theme = poster.sections.some((section) => section.takeaway === true) ? `${base}\n${POSTER_TAKEAWAY_RULE}\n` : base;
  const { height } = deckCanvasPx(size);
  const result = setPosterSettings(html, theme, { columns: poster.columns, headerHeight: round2(height * poster.headerHeight), typeScale: poster.typeScale });
  if (!result.ok) throw new RangeError(result.error);
  return { html: result.html, theme: result.theme };
}

/** A new poster's header band: the name and an authors line. */
const posterHeader = (name: string): string[] => ['<div data-block="header" data-poster="header">', `<h1>${name}</h1>`, "<p>Author names</p>", "</div>"];

/** A new poster's header band (the name and an authors line) and its Introduction, Methods and Results sections in columns 0, 1 and 2; the reflow writes their geometry. */
const POSTER_BLOCKS = (name: string): string[] => [
  ...posterHeader(name),
  ...["Introduction", "Methods", "Results"].flatMap((title, column) => [
    `<div data-block="${title.toLowerCase()}" data-poster="section" data-column="${column}">`,
    `<h2>${title}</h2>`,
    "<p>Text</p>",
    "</div>",
  ]),
];

/** The poster theme with the Poster Settings variables at their defaults for the size. */
function posterTheme(size: DeckSize): string {
  const { width, height } = deckCanvasPx(size);
  const settings = readPosterSettings("", width, height);
  const values: Array<[string, string]> = [
    [POSTER_SETTING_PROPERTIES.columns, settings.columns.join(" ")],
    [POSTER_SETTING_PROPERTIES.sectionMargin, `${settings.sectionMargin}px`],
    [POSTER_SETTING_PROPERTIES.contentMargin, `${settings.contentMargin}px`],
    [POSTER_SETTING_PROPERTIES.headerHeight, `${settings.headerHeight}px`],
    [POSTER_SETTING_PROPERTIES.typeScale, String(settings.typeScale)],
  ];
  return values.reduce((theme, [property, value]) => setThemeProperty(theme, property, value), themeOf("poster"));
}
