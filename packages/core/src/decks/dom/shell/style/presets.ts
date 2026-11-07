// The Style panel's named presets and the four candidates it shows: the current style, then three presets with other colours.
import { DEFAULT_DECK_STYLE, type DeckStyle, type DeckStyleColourToken } from "../../../deckStyleTokens.js";

/** A named style; `fonts` and `scale` say whether choosing it changes the current fonts and scale. */
export interface DeckStylePreset { name: string; style: DeckStyle; fonts: boolean; scale: boolean }

const COLOURS: readonly DeckStyleColourToken[] = ["primary", "accent", "background", "text", "muted"];
const preset = (name: string, colours: Pick<DeckStyle, DeckStyleColourToken>, fonts?: Pick<DeckStyle, "headingFont" | "bodyFont" | "monoFont">): DeckStylePreset =>
  ({ name, style: { ...DEFAULT_DECK_STYLE, ...colours, ...fonts }, fonts: fonts !== undefined, scale: false });

/** Each preset is valid and every contrast pair of it passes. */
export const DECK_STYLE_PRESETS: readonly DeckStylePreset[] = [
  { name: "Ocean", style: DEFAULT_DECK_STYLE, fonts: false, scale: false },
  preset("Forest", { primary: "#2d6a4f", accent: "#a4161a", background: "#f7faf7", text: "#1b2e24", muted: "#5b6b60" }),
  preset("Ember", { primary: "#9a3412", accent: "#b45309", background: "#fffaf5", text: "#292524", muted: "#78716c" }),
  preset("Slate", { primary: "#334155", accent: "#0369a1", background: "#f8fafc", text: "#0f172a", muted: "#64748b" }),
  preset("Plum", { primary: "#6b21a8", accent: "#be185d", background: "#fdf8ff", text: "#2e1065", muted: "#6b6478" }),
  preset("High contrast", { primary: "#ffd600", accent: "#00e5ff", background: "#000000", text: "#ffffff", muted: "#d0d0d0" }, { headingFont: "Atkinson Hyperlegible", bodyFont: "Atkinson Hyperlegible", monoFont: "JetBrains Mono" }),
];

const sameColours = (a: DeckStyle, b: DeckStyle): boolean => COLOURS.every((token) => a[token].toLowerCase() === b[token].toLowerCase());

/** The current style named Current, then three presets whose colours differ from it, from `offset` on and wrapping. */
export function namedStyleCandidates(current: DeckStyle, offset: number): Array<{ name: string; style: DeckStyle }> {
  const count = DECK_STYLE_PRESETS.length;
  const start = ((Math.trunc(offset) % count) + count) % count;
  const picked: Array<{ name: string; style: DeckStyle }> = [];
  for (let i = 0; i < count && picked.length < 3; i += 1) {
    const next = DECK_STYLE_PRESETS[(start + i) % count]!;
    if (sameColours(next.style, current)) continue;
    const { headingFont, bodyFont, monoFont, scale } = current;
    picked.push({ name: next.name, style: { ...next.style, ...(next.fonts ? {} : { headingFont, bodyFont, monoFont }), ...(next.scale ? {} : { scale }) } });
  }
  return [{ name: "Current", style: current }, ...picked];
}

/** The four styles of the Style panel's cards: `current` first, then three presets that differ from it in a colour, from `offset` on (wrapping). */
export function styleCandidates(current: DeckStyle, offset: number): DeckStyle[] {
  return namedStyleCandidates(current, offset).map((candidate) => candidate.style);
}
