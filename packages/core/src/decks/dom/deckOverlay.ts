// Deck editor overlay: one box per block in screen px, eight resize handles on each selected box, snap guides and the drag transform.
import { renderElement } from "../../ui/dom/index.js";
import type { DeckRect } from "../deckParse.js";
import type { DeckSnapResult, ResizeHandle } from "../editor/index.js";

const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

interface OverlayBlock { id: string; rect: DeckRect }

export interface DeckOverlay {
  readonly el: HTMLElement;
  /** Shows a box per block, reusing the boxes of ids it already shows, so a captured pointer survives a render. */
  render(blocks: readonly OverlayBlock[], selected: readonly string[], editing: string | null, scale: number): void;
  box(id: string): HTMLElement | undefined;
  showGuides(guides: DeckSnapResult["guides"], scale: number): void;
  clearGuides(): void;
}

const px = (value: number): string => `${value}px`;

/** A translate/scale transform taking `start` to `rect` about the element's centre, with lengths multiplied by scale. */
export function gestureTransform(start: DeckRect, rect: DeckRect, scale: number): string {
  const sx = start.width > 0 ? rect.width / start.width : 1;
  const sy = start.height > 0 ? rect.height / start.height : 1;
  const tx = (rect.left - start.left + (rect.width - start.width) / 2) * scale;
  const ty = (rect.top - start.top + (rect.height - start.height) / 2) * scale;
  const translate = `translate(${px(tx)}, ${px(ty)})`;
  return sx === 1 && sy === 1 ? translate : `${translate} scale(${sx}, ${sy})`;
}

function syncHandles(box: HTMLElement, selected: boolean): void {
  const handles = Array.from(box.querySelectorAll<HTMLElement>("[data-handle]"));
  if (!selected) {
    for (const handle of handles) handle.remove();
    return;
  }
  if (handles.length === RESIZE_HANDLES.length) return;
  for (const handle of handles) handle.remove();
  for (const name of RESIZE_HANDLES) {
    box.append(renderElement("div", { class: `deck-editor-handle deck-editor-handle-${name}`, role: "button", tabindex: "-1", "aria-label": `Resize ${name}`, "data-handle": name }));
  }
}

export function createDeckOverlay(): DeckOverlay {
  const el = renderElement("div", { class: "deck-editor-overlay" });
  const boxes = new Map<string, HTMLElement>();
  const guides: HTMLElement[] = [];
  return {
    el,
    render(blocks, selected, editing, scale) {
      const ids = new Set(blocks.map((block) => block.id));
      for (const [id, box] of boxes) {
        if (ids.has(id)) continue;
        box.remove();
        boxes.delete(id);
      }
      for (const { id, rect } of blocks) {
        let box = boxes.get(id);
        if (!box) {
          box = renderElement("div", { class: "deck-editor-box", role: "button", tabindex: "0", "aria-label": `Block ${id}`, "data-block-box": id });
          boxes.set(id, box);
        }
        el.append(box);
        box.style.left = px(rect.left * scale);
        box.style.top = px(rect.top * scale);
        box.style.width = px(rect.width * scale);
        box.style.height = px(rect.height * scale);
        const isSelected = selected.includes(id);
        box.setAttribute("aria-pressed", isSelected ? "true" : "false");
        box.classList.toggle("is-selected", isSelected);
        box.classList.toggle("is-editing", editing === id);
        syncHandles(box, isSelected && editing !== id);
      }
    },
    box: (id) => boxes.get(id),
    showGuides(next, scale) {
      for (const guide of guides.splice(0)) guide.remove();
      for (const guide of next) {
        const line = renderElement("div", { class: `deck-editor-guide deck-editor-guide-${guide.axis}`, "aria-hidden": "true" });
        if (guide.axis === "x") {
          line.style.left = px(guide.at * scale);
          line.style.top = px(guide.from * scale);
          line.style.height = px((guide.to - guide.from) * scale);
        } else {
          line.style.top = px(guide.at * scale);
          line.style.left = px(guide.from * scale);
          line.style.width = px((guide.to - guide.from) * scale);
        }
        guides.push(line);
        el.append(line);
      }
    },
    clearGuides() {
      for (const guide of guides.splice(0)) guide.remove();
    },
  };
}
