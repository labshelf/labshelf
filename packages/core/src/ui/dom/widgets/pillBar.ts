// The floating pill every text bubble shares (the PDF reader's selection bubble, the notes' bubble and the source editor's popup): round icon buttons in groups set off by a thin rule.
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement } from "../dom.js";
import { attachHoverCard } from "./hoverCard.js";

export interface PillButton {
  label: string;
  icon: IconName;
  run(button: HTMLButtonElement): void;
  /** Shown under the label in the hover card, such as the key that does the same. */
  shortcut?: string;
  pressed?: boolean;
  disabled?: boolean;
}

/** One round icon button; the hover card names it and its shortcut. */
export function renderPillButton(item: PillButton): HTMLButtonElement {
  const button = renderElement("button", { type: "button", class: "ls-pill-btn", "aria-label": item.label, html: renderIcon(item.icon) });
  if (item.pressed !== undefined) button.setAttribute("aria-pressed", String(item.pressed));
  button.disabled = item.disabled === true;
  button.addEventListener("click", () => item.run(button));
  attachHoverCard(button, () => ({ label: item.label, ...(item.shortcut && { description: item.shortcut }) }));
  return button;
}

export function renderPillSeparator(): HTMLElement {
  return renderElement("span", { class: "ls-pill-sep", "aria-hidden": "true" });
}

/** A group is buttons to render or elements already built (the reader's colour dots); empty groups are skipped. */
export type PillGroup = readonly (PillButton | HTMLElement)[];

/** Fills `pill` (or a new toolbar) with the groups, a separator between each two; a press never takes the focus or the selection. */
export function renderPillBar(groups: readonly PillGroup[], options: { label: string; pill?: HTMLElement }): HTMLElement {
  const pill = options.pill ?? renderElement("div", { role: "toolbar" });
  pill.classList.add("ls-pill");
  pill.setAttribute("aria-label", options.label);
  pill.replaceChildren();
  for (const group of groups.filter((items) => items.length > 0)) {
    if (pill.childElementCount > 0) pill.append(renderPillSeparator());
    pill.append(...group.map((item) => (item instanceof HTMLElement ? item : renderPillButton(item))));
  }
  if (!pill.dataset["pillBound"]) {
    pill.dataset["pillBound"] = "true";
    pill.addEventListener("mousedown", (event) => { if (!(event.target instanceof HTMLInputElement)) event.preventDefault(); });
  }
  return pill;
}

/** How far, in pixels, a press may move and still count as held in place. */
const STILL_PX = 4;
/** How long, in milliseconds, a press is held before it opens a bubble. */
const HOLD_MS = 450;
/** How long a press waits before its ring shows, so a plain click never flashes one. */
const RING_DELAY_MS = 150;

/** The ring that grows at the press point while a press is held (pill.css .ls-hold-ring), closing in as the bubble is about to open. */
function renderHoldRing(x: number, y: number): HTMLElement {
  const ring = renderElement("div", { class: "ls-hold-ring", "aria-hidden": "true" });
  Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, animationDelay: `${RING_DELAY_MS}ms`, animationDuration: `${HOLD_MS - RING_DELAY_MS}ms` });
  document.body.append(ring);
  return ring;
}

/**
 * Opens a bubble's click actions on a press held in place: `press` starts on a single left mousedown that landed where the bubble may open, and `onHold` runs
 * once it has been held for HOLD_MS without moving, while a ring closes in on the press point; a release, a move or `cancel` drops it. A plain click, a drag
 * and a double click never open the bubble.
 */
export function trackPressAndHold(onHold: () => void): { press(event: MouseEvent, onTarget: boolean): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let origin: { x: number; y: number } | undefined;
  let ring: HTMLElement | undefined;
  const cancel = (): void => {
    clearTimeout(timer);
    timer = undefined;
    origin = undefined;
    ring?.remove();
    ring = undefined;
    window.removeEventListener("mousemove", move, true);
    window.removeEventListener("mouseup", cancel, true);
  };
  const move = (event: MouseEvent): void => {
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) >= STILL_PX) cancel();
  };
  return {
    press(event, onTarget) {
      cancel();
      if (!onTarget || event.button !== 0 || event.detail > 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      origin = { x: event.clientX, y: event.clientY };
      ring = renderHoldRing(event.clientX, event.clientY);
      window.addEventListener("mousemove", move, true);
      window.addEventListener("mouseup", cancel, true);
      timer = setTimeout(() => { cancel(); onHold(); }, HOLD_MS);
    },
    cancel,
  };
}
