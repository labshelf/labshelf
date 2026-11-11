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

/** How far, in pixels, a press may move and still count as a click. */
const STILL_PX = 4;

/**
 * Tells a still single click, which opens a bubble's click actions, from a drag or a double click: `press` records the mousedown, with whether it
 * landed where a click may open the bubble; `isStill` then says whether the mouseup ended a single click that stayed in place.
 */
export function trackStillClick(): { press(event: MouseEvent, onTarget: boolean): void; isStill(event: MouseEvent): boolean } {
  let pressed: { x: number; y: number; onTarget: boolean } | undefined;
  return {
    press: (event, onTarget) => { pressed = { x: event.clientX, y: event.clientY, onTarget }; },
    isStill: (event) => pressed !== undefined && pressed.onTarget && event.detail <= 1 && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < STILL_PX,
  };
}
