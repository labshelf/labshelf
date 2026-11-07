// The Style panel's candidate cards: a 2x2 grid of buttons, each with its name and a preview of the current slide in its style.
// Previews are asked for lazily, one at a time in card order, and kept by style for the life of the panel.
import { renderElement } from "../../../../ui/dom/index.js";
import type { DeckStyle } from "../../../deckStyleTokens.js";
import type { DeckStylePort, DeckStylePreview } from "./types.js";

export interface StyleCard { name: string; style: DeckStyle }

const SWATCH_TOKENS = ["primary", "accent", "background", "text", "muted"] as const;
export const styleKey = (style: DeckStyle): string => JSON.stringify(style);

/** The five colours of a style as swatches, set through the CSSOM. */
function swatches(style: DeckStyle, note: string): HTMLElement[] {
  const row = renderElement("span", { class: "dsh-style-swatches", "aria-hidden": "true" });
  for (const token of SWATCH_TOKENS) {
    const swatch = renderElement("span", { class: "dsh-style-swatch" });
    swatch.style.backgroundColor = style[token];
    row.append(swatch);
  }
  return [row, renderElement("span", { class: "dsh-style-preview-note", text: note })];
}

function drawPreview(area: HTMLElement, style: DeckStyle, preview: DeckStylePreview | undefined): void {
  if (!preview) return void area.replaceChildren(renderElement("span", { class: "dsh-style-preview-note", text: "Loading preview…" }));
  area.replaceChildren(...(preview.kind === "image" ? [renderElement("img", { src: preview.src, alt: "" })] : swatches(style, preview.note)));
}

export interface StylePreviews {
  /** Forgets the shown areas; the grid calls it before drawing its cards again. */
  begin(): void;
  /** Draws a preview area for `style`, filled now when cached, later otherwise. */
  area(style: DeckStyle): HTMLElement;
  /** Asks for the missing previews of the shown areas, in order. */
  pump(): void;
  /** Forgets every cached preview. */
  clear(): void;
  destroy(): void;
}

/** The preview cache and queue of one mounted panel. */
export function createStylePreviews(port: DeckStylePort): StylePreviews {
  const cache = new Map<string, DeckStylePreview>();
  let areas: Array<{ element: HTMLElement; style: DeckStyle }> = [];
  let busy = false;
  let destroyed = false;
  let generation = 0;
  const pump = (): void => {
    if (busy || destroyed) return;
    const next = areas.find((area) => !cache.has(styleKey(area.style)));
    if (!next) return;
    busy = true;
    const key = styleKey(next.style);
    const asked = generation;
    const done = (preview: DeckStylePreview): void => {
      busy = false;
      if (destroyed) return;
      if (asked === generation) {
        cache.set(key, preview);
        for (const area of areas) if (styleKey(area.style) === key) drawPreview(area.element, area.style, preview);
      }
      pump();
    };
    port.preview(next.style).then(done, () => done({ kind: "swatches", note: "Preview failed" }));
  };
  return {
    begin() { areas = []; },
    area(style) {
      const element = renderElement("span", { class: "dsh-style-preview" });
      drawPreview(element, style, cache.get(styleKey(style)));
      areas.push({ element, style });
      return element;
    },
    pump,
    clear() { cache.clear(); generation += 1; },
    destroy() { destroyed = true; areas = []; },
  };
}

/** The 2x2 grid of cards; the chosen one is pressed. */
export function cardGrid(cards: readonly StyleCard[], chosen: number, previews: StylePreviews, choose: (index: number) => void): HTMLElement {
  const grid = renderElement("div", { class: "dsh-style-cards", role: "group", "aria-label": "Candidates" });
  previews.begin();
  cards.forEach((card, index) => {
    const button = renderElement("button", { type: "button", class: "dsh-style-card", "aria-pressed": String(index === chosen) },
      previews.area(card.style), renderElement("span", { class: "dsh-style-card-name", text: card.name }));
    button.addEventListener("click", () => choose(index));
    grid.append(button);
  });
  return grid;
}
