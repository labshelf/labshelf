/**
 * Shows one anchored popover at a time, used for the theme picker and the zoom menu.
 */
import { clamp } from "./dom.js";
import { renderElement } from "../../../ui/dom/index.js";

let current: { popover: HTMLElement; anchor: HTMLElement; cleanup: () => void } | null = null;
const openListeners: Array<(open: boolean) => void> = [];

export function onPopoverToggle(fn: (open: boolean) => void): void { openListeners.push(fn); }
/**
 * @returns true while a popover is on screen.
 */
export function isPopoverOpen(): boolean { return current !== null; }

/**
 * Closes the open popover, if any, and restores its anchor's aria-expanded state.
 */
export function closePopover(): void {
  if (!current) { return; }
  const { popover, anchor, cleanup } = current;
  current = null;
  cleanup();
  popover.remove();
  anchor.setAttribute("aria-expanded", "false");
  for (const fn of openListeners) { fn(false); }
}

/**
 * Opens `content` next to `anchor`; clicking the same anchor again closes it.
 */
export function togglePopover(anchor: HTMLElement, content: HTMLElement, placement: "below" | "above"): void {
  const wasSameAnchor = current?.anchor === anchor;
  closePopover();
  if (wasSameAnchor) { return; }

  const popover = renderElement("div", { class: "rd-popover", role: "dialog" }, content);
  document.body.append(popover);
  const a = anchor.getBoundingClientRect();
  const p = popover.getBoundingClientRect();
  const left = clamp(a.right - p.width, 8, window.innerWidth - p.width - 8);
  const top = placement === "below" ? a.bottom + 6 : a.top - p.height - 6;
  popover.style.left = `${left}px`;
  popover.style.top = `${clamp(top, 8, window.innerHeight - p.height - 8)}px`;
  anchor.setAttribute("aria-expanded", "true");

  const onDown = (e: MouseEvent): void => {
    const t = e.target as Node;
    if (!popover.contains(t) && !anchor.contains(t)) { closePopover(); }
  };
  document.addEventListener("mousedown", onDown, true);
  current = { popover, anchor, cleanup: () => document.removeEventListener("mousedown", onDown, true) };
  for (const fn of openListeners) { fn(true); }
  popover.querySelector<HTMLElement>("button, input, [tabindex]")?.focus({ preventScroll: true });
}

export interface MenuItem {
  label: string;
  hint?: string;
  checked?: boolean;
  separatorBefore?: boolean;
  run(): void;
}

/**
 * @returns a menu element whose items close the popover before running.
 */
export function buildMenu(items: readonly MenuItem[]): HTMLElement {
  const menu = renderElement("div", { class: "rd-menu", role: "menu" });
  for (const item of items) {
    if (item.separatorBefore) { menu.append(renderElement("div", { class: "rd-menu-sep" })); }
    const btn = renderElement(
      "button",
      { class: "rd-menu-item", type: "button", role: "menuitemradio", "aria-checked": item.checked ? "true" : "false" },
      renderElement("span", { class: "rd-menu-label" }, item.label),
      item.hint ? renderElement("span", { class: "rd-menu-hint" }, item.hint) : null,
    );
    btn.addEventListener("click", () => { closePopover(); item.run(); });
    menu.append(btn);
  }
  return menu;
}
