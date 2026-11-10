// The note popover shared by the reader's floating note and the source editor's Add comment: a card with a small grey title, the body the host fills,
// a corner grip that sizes it between limits (the size is kept per kind while the page lives) and placement beside an anchor or under a line.
import { renderElement } from "../dom.js";

/** The popover's size limits; past the largest the host offers a bigger view instead (the reader's sidebar). */
export const NOTE_POPOVER_MIN = { width: 320, height: 220 };
export const NOTE_POPOVER_MAX_WIDTH = 640;
export const NOTE_POPOVER_MAX_HEIGHT_SHARE = 0.8;
const RESIZE_STEP = 16;
const GAP = 8;

interface Size { width: number; height: number }
/** A rectangle on screen the popover is placed against. */
export interface PopoverAnchor { left: number; right: number; top: number; bottom: number }

/** The size the user dragged each kind of popover to, so the next one of that kind opens at it. */
const sizes = new Map<string, Size>();

export interface NotePopover {
  readonly el: HTMLElement;
  /** The header's row: the title first, then whatever the host adds (a source link, actions). */
  readonly head: HTMLElement;
  readonly body: HTMLElement;
  /** Applies the kept size of this kind (or the default one). */
  applySize(): void;
  /**
   * `beside` puts it to the right of `anchor` (to the left when there is no room), top-aligned; `below` puts it under `anchor`, or over `over` when
   * there is no room below, starting at `anchor.left`. No anchor centres it near the top. It always stays inside the window.
   */
  place(anchor: PopoverAnchor | null, how: "beside" | "below", over?: PopoverAnchor | null): void;
}

/** Builds a hidden-until-appended popover; `kind` keys the kept size, `className` adds the host's own class (its theme variables). */
export function createNotePopover(options: { kind: string; title: string; label: string; className?: string; head?: readonly (HTMLElement | null)[]; foot?: HTMLElement }): NotePopover {
  const head = renderElement("header", { class: "ls-note-popover-head" }, renderElement("span", { class: "ls-note-popover-title" }, options.title), ...(options.head ?? []));
  const body = renderElement("div", { class: "ls-note-popover-body" });
  const el = renderElement("section", { class: `ls-note-popover ${options.className ?? ""}`.trim(), role: "dialog", "aria-label": options.label }, head, body);
  if (options.foot) el.append(options.foot);
  const applySize = (): void => {
    const size = sizes.get(options.kind);
    el.style.width = size ? `${size.width}px` : "";
    el.style.height = size ? `${size.height}px` : "";
  };
  const resizeTo = (width: number, height: number): void => {
    const box = el.getBoundingClientRect();
    const maxWidth = Math.max(NOTE_POPOVER_MIN.width, Math.min(NOTE_POPOVER_MAX_WIDTH, window.innerWidth - box.left - GAP));
    const maxHeight = Math.max(NOTE_POPOVER_MIN.height, Math.min(window.innerHeight * NOTE_POPOVER_MAX_HEIGHT_SHARE, window.innerHeight - box.top - GAP));
    sizes.set(options.kind, { width: clamp(width, NOTE_POPOVER_MIN.width, maxWidth), height: clamp(height, NOTE_POPOVER_MIN.height, maxHeight) });
    applySize();
  };
  el.append(renderResizeHandle(el, resizeTo));
  return {
    el, head, body, applySize,
    place(anchor, how, over) {
      const box = el.getBoundingClientRect();
      let left: number;
      let top: number;
      if (!anchor) { left = (window.innerWidth - box.width) / 2; top = 64; }
      else if (how === "beside") {
        const right = anchor.right + 12;
        left = right + box.width > window.innerWidth - GAP ? anchor.left - box.width - 12 : right;
        top = anchor.top;
      } else {
        const above = (over ?? anchor).top - box.height - GAP;
        top = anchor.bottom + GAP + box.height > window.innerHeight - GAP && above >= GAP ? above : anchor.bottom + GAP;
        left = anchor.left;
      }
      el.style.left = `${clamp(left, GAP, Math.max(GAP, window.innerWidth - box.width - GAP))}px`;
      el.style.top = `${clamp(top, GAP, Math.max(GAP, window.innerHeight - box.height - GAP))}px`;
    },
  };
}

/** The corner grip: dragging it, or the arrow keys while it has focus, sizes the popover within the limits. */
function renderResizeHandle(el: HTMLElement, resizeTo: (width: number, height: number) => void): HTMLElement {
  const handle = renderElement("div", { class: "ls-note-popover-resize", role: "separator", tabindex: "0", "aria-label": "Resize", title: "Drag to resize" });
  handle.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const box = el.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY, width: box.width, height: box.height };
    handle.setPointerCapture?.(event.pointerId);
    const move = (next: PointerEvent): void => resizeTo(start.width + next.clientX - start.x, start.height + next.clientY - start.y);
    const end = (): void => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  });
  handle.addEventListener("keydown", (event) => {
    const step: Record<string, [number, number]> = { ArrowLeft: [-RESIZE_STEP, 0], ArrowRight: [RESIZE_STEP, 0], ArrowUp: [0, -RESIZE_STEP], ArrowDown: [0, RESIZE_STEP] };
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    const box = el.getBoundingClientRect();
    resizeTo(box.width + delta[0], box.height + delta[1]);
  });
  return handle;
}

function clamp(value: number, min: number, max: number): number { return Math.min(max, Math.max(min, value)); }
