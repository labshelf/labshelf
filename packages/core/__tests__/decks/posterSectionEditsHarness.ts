// Fixtures and helpers shared by the poster section tests: sectioned poster documents and readers of their layout and blocks.
import { parseDeck, type DeckBlock, type DeckRect } from "../../src/decks/deckParse.js";
import { readThemeProperties } from "../../src/decks/themeCss.js";
import type { PosterEditResult } from "../../src/decks/posterSectionEdits.js";
import { readPosterLayout, type PosterBox, type PosterLayout } from "../../src/decks/posterSections.js";
import { doc, slide } from "./deckSamples.js";

export const W = 1920;
export const H = 2880;
export const THEME = ":root { --deck-bg: #ffffff; }\n";
const STYLE0 = "left: 0px; top: 0px; width: 10px; height: 10px;";
const rootOf = (size: string): string => `data-deck="poster" data-deck-version="1" data-deck-size="${size}"`;

export const header = `<div data-block="head" data-poster="header" style="${STYLE0} background: #ddd;"><h1>Title</h1><p>Authors</p></div>`;
export const section = (id: string, attributes: string): string =>
  `<div data-block="${id}" data-poster="section" ${attributes} style="${STYLE0} background: #eee;"><h2>${id} head</h2><p>Text ${id}</p></div>`;
export const LOGO = '<div data-block="logo" style="left: 1700px; top: 2700px; width: 150px; height: 100px;"><p>QR</p></div>';
export const posterDoc = (blocks: string[], size = "20x30in"): string => doc(rootOf(size), slide(blocks.join("\n")));

const FOUR = [
  header,
  section("s1", 'data-column="0"'),
  section("s2", 'data-column="0"'),
  section("s3", 'data-column="1"'),
  section("s4", 'data-column="2"'),
  LOGO,
];
export const fourSections = (size = "20x30in"): string => posterDoc(FOUR, size);

export const must = (result: PosterEditResult): { html: string; theme: string } => {
  if (!result.ok) throw new Error(result.error);
  return result;
};
/** The layout of a poster given as html with a theme, or as the result of an edit. */
export const layoutOf = (source: string | { html: string; theme: string }, theme = THEME): PosterLayout => {
  const layout = typeof source === "string" ? readPosterLayout(source, theme) : readPosterLayout(source.html, source.theme);
  if (!layout) throw new Error("expected a sectioned poster");
  return layout;
};
export const ids = (layout: PosterLayout): string[][] => layout.columns.map((column) => column.map((box) => box.id));
export const boxOf = (layout: PosterLayout, id: string): PosterBox => {
  const found = [...(layout.header ? [layout.header] : []), ...layout.columns.flat()].find((box) => box.id === id);
  if (!found) throw new Error(`no box ${id}`);
  return found;
};
export const blocksOf = (html: string): DeckBlock[] => parseDeck(html).model!.slides[0]!.blocks;
export const blockText = (html: string, id: string): string => {
  const block = blocksOf(html).find((candidate) => candidate.id === id);
  if (!block) throw new Error(`no block ${id}`);
  return html.slice(block.range.from, block.range.to);
};
export const prop = (theme: string, name: string): string | undefined => readThemeProperties(theme).filter((property) => property.name === name).pop()?.value;
export const numbers = (value: string | undefined): number[] => (value ?? "").trim().split(/\s+/).map(Number);
export const px = (value: string | undefined): number => Number((value ?? "").replace(/px$/, ""));
export const sizeAttribute = (html: string): string | undefined => /data-deck-size="([^"]*)"/.exec(html)?.[1];
const GEOMETRY = /(?<=["; ])(?:left|top|width|height)\s*:\s*[^;"]*;?/g;
export const withoutGeometry = (html: string): string => html.replace(GEOMETRY, "").replace(/\s+/g, " ");
export const apart = (a: DeckRect, b: DeckRect): boolean =>
  a.left + a.width <= b.left + 0.01 || b.left + b.width <= a.left + 0.01 || a.top + a.height <= b.top + 0.01 || b.top + b.height <= a.top + 0.01;
