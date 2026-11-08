// Shared sizes, choice builders and scaffold helpers of the deckTemplates tests.
import { DEFAULT_DECK_STYLE, type DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { DECK_STYLE_PRESETS } from "../../src/decks/deckStylePresets.js";
import { deckCanvasPx, type DeckKind, type DeckSize } from "../../src/decks/deckSizes.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { scaffoldDeckFromTemplate, type DeckTemplateChoice, type DeckTemplateFormat } from "../../src/decks/deckTemplates.js";

export const FORMATS: DeckTemplateFormat[] = ["html", "latex", "typst"];
export const TALK_16_9: DeckSize = { w: 1920, h: 1080, unit: "px" };
export const TALK_4_3: DeckSize = { w: 1440, h: 1080, unit: "px" };
export const A0: DeckSize = { w: 841, h: 1189, unit: "mm" };
export const A0_LANDSCAPE: DeckSize = { w: 1189, h: 841, unit: "mm" };
export const A3: DeckSize = { w: 297, h: 420, unit: "mm" };
export const TITLE = "Cell migration";
export const NAME = "cell-migration";

export const choice = (kind: DeckKind, format: DeckTemplateFormat, template: string, over: Partial<DeckTemplateChoice> = {}): DeckTemplateChoice => ({
  kind, format, template, title: TITLE, size: kind === "talk" ? TALK_16_9 : A0, style: null, ...over,
});

export const FOREST = DECK_STYLE_PRESETS.find((preset) => preset.name === "Forest")!.style;
export const KIT_STYLE: DeckStyle = { ...DEFAULT_DECK_STYLE, primary: "#7a1f3d", accent: "#0a7d5a", background: "#fbf7f2" };

export const files = (c: DeckTemplateChoice, name = NAME) => scaffoldDeckFromTemplate(c, name);
export const fileText = (c: DeckTemplateChoice, name = NAME): string => files(c, name).find((f) => f.path !== "theme.css")!.text;
export const htmlDeck = (c: DeckTemplateChoice, name = NAME): { html: string; theme: string } => {
  const out = files(c, name);
  return { html: out.find((f) => f.path === "deck.html")!.text, theme: out.find((f) => f.path === "theme.css")!.text };
};
export const validate = (deck: { html: string; theme: string }) => validateDeck(deck.html, { theme: deck.theme, files: new Set(["theme.css"]) });
export const count = (text: string, part: string): number => text.split(part).length - 1;
/** The markup of each poster section block, as the text from its opening div to the next block. */
export const sectionChunks = (html: string): string[] => html.split(/(?=<div\b)/).filter((chunk) => chunk.includes('data-poster="section"'));
export const columnOf = (chunk: string): number => Number(/data-column="(\d+)"/.exec(chunk)![1]);
export const sizeOfDeck = (html: string): { width: number; height: number } => {
  const match = /data-deck-size="(\d+(?:\.\d)?)x(\d+(?:\.\d)?)(px|mm|in)"/.exec(html)!;
  return deckCanvasPx({ w: Number(match[1]), h: Number(match[2]), unit: match[3] as DeckSize["unit"] });
};
