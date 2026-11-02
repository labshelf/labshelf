// Deck asset references: the url() and attribute references of deck source that name deck paths, shared by the export and the slide frame.
import type { DeckAttribute, DeckRange } from "./deckTokens.js";
import { classifyReference, findCssUrls, readSrcset } from "./deckValidateCss.js";

/** A reference to an asset: the source range of its URL text and the deck path it names. */
export interface AssetReference { range: DeckRange; path: string }

/** The reference at [from, to) of `text` when it names a deck path, its surrounding whitespace left out of the range. */
function referenceAt(text: string, from: number, to: number, out: AssetReference[]): void {
  const raw = text.slice(from, to);
  const reference = classifyReference(raw);
  if (reference.kind !== "path") return;
  const start = from + (raw.length - raw.trimStart().length);
  out.push({ range: { from: start, to: start + raw.trim().length }, path: reference.path });
}

/** The url() references of a CSS text whose offset 0 sits at `from` in `text`. */
export function cssReferences(text: string, from: number, css: string, out: AssetReference[]): void {
  for (const url of findCssUrls(css)) {
    let at = url.offset + 4;
    while (/\s/.test(css[at] ?? "")) at++;
    if (css[at] === '"' || css[at] === "'") at++;
    if (css.slice(at, at + url.text.length) !== url.text) continue;
    referenceAt(text, from + at, from + at + url.text.length, out);
  }
}

const isSvgAsset = (element: string): boolean => element === "image" || element === "use";

/** The asset references of one start tag, as validateDeck checks them. */
export function tagReferences(html: string, name: string, attributes: DeckAttribute[], out: AssetReference[]): void {
  for (const attribute of attributes) {
    const range = attribute.valueRange;
    if (!range) continue;
    const key = attribute.name;
    if (key === "src" || key === "poster" || (key === "href" && (name === "link" || isSvgAsset(name))) || (key === "xlink:href" && isSvgAsset(name))) referenceAt(html, range.from, range.to, out);
    else if (key === "srcset") for (const candidate of readSrcset(html.slice(range.from, range.to))) referenceAt(html, range.from + candidate.offset, range.from + candidate.offset + candidate.text.length, out);
    else if (key === "style") cssReferences(html, range.from, html.slice(range.from, range.to), out);
  }
}
