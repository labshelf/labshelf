// Deck editor overlay: one box per block in screen px, eight resize handles on the one selected box (or on one union box around several),
// snap and spacing guides, the marquee and the drag transform, plus the link badges drawn over the linked boxes.
import { renderElement } from "../../ui/dom/index.js";
import { deriveLinkState, readDeckLinks, type DeckLinkSources, type DeckLinkStatus } from "../deckLinks.js";
import type { DeckModel, DeckRect } from "../deckParse.js";
import { unionRect } from "../deckGroupGesture.js";
import type { DeckSnapResult, ResizeHandle } from "../deckSnap.js";

const RESIZE_HANDLES: readonly ResizeHandle[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

interface OverlayBlock { id: string; rect: DeckRect }

export interface DeckOverlay {
  readonly el: HTMLElement;
  /** Shows a box per block, reusing the boxes of ids it already shows, so a captured pointer survives a render. */
  render(blocks: readonly OverlayBlock[], selected: readonly string[], editing: string | null, scale: number): void;
  box(id: string): HTMLElement | undefined;
  /** The box around several selected blocks that holds their shared handles, when more than one is selected. */
  selectionBox(): HTMLElement | undefined;
  /** Shows the marquee rect (slide px), or removes it for null. */
  showMarquee(rect: DeckRect | null, scale: number): void;
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

function placeRect(element: HTMLElement, rect: DeckRect, scale: number): void {
  element.style.left = px(rect.left * scale);
  element.style.top = px(rect.top * scale);
  element.style.width = px(rect.width * scale);
  element.style.height = px(rect.height * scale);
}

/** Puts a block box on its rect in screen px and shows its selected and editing state; `handles` is false for a member of a union box. */
function placeBox(box: HTMLElement, rect: DeckRect, scale: number, isSelected: boolean, isEditing: boolean, handles: boolean): void {
  placeRect(box, rect, scale);
  box.setAttribute("aria-pressed", isSelected ? "true" : "false");
  box.classList.toggle("is-selected", isSelected);
  box.classList.toggle("is-editing", isEditing);
  syncHandles(box, handles && isSelected && !isEditing);
}

/** One snap guide as a line in screen px. */
function guideLine(guide: DeckSnapResult["guides"][number], scale: number): HTMLElement {
  const spacing = guide.kind === "spacing" ? " deck-editor-guide-spacing" : "";
  const line = renderElement("div", { class: `deck-editor-guide deck-editor-guide-${guide.axis}${spacing}`, "aria-hidden": "true" });
  if (guide.axis === "x") {
    line.style.left = px(guide.at * scale);
    line.style.top = px(guide.from * scale);
    line.style.height = px((guide.to - guide.from) * scale);
  } else {
    line.style.top = px(guide.at * scale);
    line.style.left = px(guide.from * scale);
    line.style.width = px((guide.to - guide.from) * scale);
  }
  return line;
}

export function createDeckOverlay(): DeckOverlay {
  const el = renderElement("div", { class: "deck-editor-overlay" });
  const boxes = new Map<string, HTMLElement>();
  const guides: HTMLElement[] = [];
  let union: HTMLElement | undefined;
  let marquee: HTMLElement | undefined;
  return {
    el,
    render(blocks, selected, editing, scale) {
      const members = blocks.filter((block) => selected.includes(block.id) && block.id !== editing);
      const several = members.length > 1;
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
        placeBox(box, rect, scale, selected.includes(id), editing === id, !several);
      }
      if (!several) {
        union?.remove();
        union = undefined;
        return;
      }
      union ??= renderElement("div", { class: "deck-editor-selection", "data-selection-box": "" });
      placeRect(union, unionRect(members.map((member) => member.rect)), scale);
      syncHandles(union, true);
      el.append(union);
    },
    box: (id) => boxes.get(id),
    selectionBox: () => union,
    showMarquee(rect, scale) {
      if (!rect) {
        marquee?.remove();
        marquee = undefined;
        return;
      }
      marquee ??= renderElement("div", { class: "deck-editor-marquee", "aria-hidden": "true" });
      placeRect(marquee, rect, scale);
      el.append(marquee);
    },
    showGuides(next, scale) {
      for (const guide of guides.splice(0)) guide.remove();
      for (const guide of next) {
        const line = guideLine(guide, scale);
        guides.push(line);
        el.append(line);
      }
    },
    clearGuides() {
      for (const guide of guides.splice(0)) guide.remove();
    },
  };
}

export interface LinkBadgeTarget { block: string; status: DeckLinkStatus; box: HTMLElement }

export interface LinkBadgeSync { refresh(model: DeckModel | undefined, slide: number): void; destroy(): void }

const BADGE = "[data-link-badge]";

/** Replaces the badge of each target box: a stale link gets Out of date and an Update button, a missing one Source missing, a fresh one nothing. */
export function renderLinkBadges(targets: readonly LinkBadgeTarget[], onUpdate: (block: string, status: DeckLinkStatus) => void): void {
  for (const { block, status, box } of targets) {
    box.querySelector(BADGE)?.remove();
    if (status.state === "fresh") continue;
    const badge = renderElement("span", { class: `deck-editor-link-badge is-${status.state}`, "data-link-badge": status.state }, status.state === "stale" ? "Out of date" : "Source missing");
    if (status.state === "stale") {
      const update = renderElement("button", { type: "button", class: "deck-editor-link-update", "aria-label": `Update block ${block} from its source`, text: "Update" });
      update.addEventListener("click", (event) => {
        event.stopPropagation();
        onUpdate(block, status);
      });
      badge.append(update);
    }
    // A press on the badge is not a press on the block: it starts no selection or drag.
    badge.addEventListener("pointerdown", (event) => event.stopPropagation());
    box.append(badge);
  }
}

/** Derives the state of every link on a slide and shows the badges; an older derivation never overwrites a newer one. */
export function createLinkBadgeSync(options: { sources: DeckLinkSources; box(block: string): HTMLElement | undefined; onUpdate(block: string, status: DeckLinkStatus): void }): LinkBadgeSync {
  let token = 0;
  let shown = new Set<HTMLElement>();
  let last: { model: DeckModel | undefined; slide: number } | null = null;
  const clear = (keep: ReadonlySet<HTMLElement>): void => {
    for (const box of shown) if (!keep.has(box)) box.querySelector(BADGE)?.remove();
  };
  return {
    refresh(model, slide) {
      if (last && last.model === model && last.slide === slide) return;
      last = { model, slide };
      const mine = ++token;
      const links = model ? readDeckLinks(model).filter((link) => link.slide === slide) : [];
      if (links.length === 0) {
        clear(new Set());
        shown = new Set();
        return;
      }
      void Promise.all(links.map((link) => deriveLinkState(link, options.sources))).then((statuses) => {
        if (mine !== token) return;
        const targets = links.flatMap((link, index) => {
          const box = options.box(link.block);
          return box ? [{ block: link.block, status: statuses[index]!, box }] : [];
        });
        const next = new Set(targets.map((target) => target.box));
        clear(next);
        shown = next;
        renderLinkBadges(targets, options.onUpdate);
      }, () => undefined);
    },
    destroy() {
      token += 1;
      clear(new Set());
    },
  };
}
