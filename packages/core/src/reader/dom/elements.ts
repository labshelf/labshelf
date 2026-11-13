// Shares the reader's small DOM helpers: icon buttons, number clamping, text input checks, popover menus and the tab strip.
import { ANNOTATION_COLORS, type AnnotationColor } from "../../model/index.js";
import { renderIcon } from "../../ui/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { readerLayer } from "./scope.js";

/**
 * Provides the reader's small DOM helpers: icon buttons, text-input detection and clamping.
 */

/**
 * Icon-only button with an accessible name; the tooltip doubles as shortcut documentation.
 * @returns the button element.
 */
export function renderReaderIconButton(iconHtml: string, title: string, extraClass = ""): HTMLButtonElement {
  return renderElement("button", {
    class: `rd-btn ${extraClass}`.trim(),
    type: "button",
    title,
    "aria-label": title,
    html: iconHtml,
  });
}

/**
 * A quiet trash button labelled `label`: it calls `remove` at once when `hasText()` is false, else first shows `confirmLabel` and waits for a second click.
 * Leaving the button, or any of `alsoCancelOn`, cancels the pending confirmation.
 */
export function renderConfirmDelete(options: { label: string; confirmLabel: string; hasText(): boolean; remove(): void; extraClass?: string; alsoCancelOn?: readonly HTMLElement[] }): HTMLButtonElement {
  const { label, confirmLabel, hasText, remove, extraClass = "", alsoCancelOn = [] } = options;
  const button = renderReaderIconButton(renderIcon("trash"), label, `rd-btn-sm ${extraClass}`.trim());
  let confirming = false;
  const confirm = (on: boolean): void => {
    confirming = on;
    button.classList.toggle("rd-danger", on);
    button.title = on ? confirmLabel : label;
    button.setAttribute("aria-label", button.title);
  };
  button.addEventListener("click", () => {
    if (hasText() && !confirming) { confirm(true); return; }
    confirm(false);
    remove();
  });
  for (const el of [button, ...alsoCancelOn]) { el.addEventListener("blur", () => confirm(false)); }
  return button;
}

/**
 * @returns true when typing into the target should produce text rather than trigger single-key shortcuts.
 */
export function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) { return false; }
  if (target.isContentEditable) { return true; }
  if (target instanceof HTMLTextAreaElement) { return true; }
  if (target instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "color", "range"].includes(target.type);
  }
  return false;
}

/**
 * @returns `n` limited to [min, max].
 */
export function deriveClampedNumber(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Shows one anchored popover at a time, used for the theme picker and the zoom menu.
 */

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
export function updatePopoverOpen(anchor: HTMLElement, content: HTMLElement, placement: "below" | "above"): void {
  const wasSameAnchor = current?.anchor === anchor;
  closePopover();
  if (wasSameAnchor) { return; }

  const popover = renderElement("div", { class: "rd-popover", role: "dialog" }, content);
  readerLayer().append(popover);
  const a = anchor.getBoundingClientRect();
  const p = popover.getBoundingClientRect();
  const left = deriveClampedNumber(a.right - p.width, 8, window.innerWidth - p.width - 8);
  const top = placement === "below" ? a.bottom + 6 : a.top - p.height - 6;
  popover.style.left = `${left}px`;
  popover.style.top = `${deriveClampedNumber(top, 8, window.innerHeight - p.height - 8)}px`;
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


/** Shows the active annotation colour and a palette shared by highlight and underline tools. */
export class AnnotationColorPicker {
  readonly el = renderElement("div", { class: "rd-annotation-color", hidden: true });
  private color: AnnotationColor = "yellow";
  private readonly swatch = renderElement("span", { class: "rd-annotation-swatch rd-color-yellow", "aria-hidden": "true" });
  private readonly button = renderReaderIconButton("", "Annotation color: yellow");

  constructor(private readonly select: (color: AnnotationColor) => void) {
    this.button.classList.add("rd-annotation-color-button");
    this.button.setAttribute("aria-haspopup", "menu");
    this.button.setAttribute("aria-expanded", "false");
    this.button.append(this.swatch, renderElement("span", { class: "rd-color-caret", html: renderIcon("chevron-down"), "aria-hidden": "true" }));
    this.button.addEventListener("click", () => this.open());
    this.el.append(this.button);
  }

  setColor(color: AnnotationColor): void {
    this.color = color;
    this.swatch.className = `rd-annotation-swatch rd-color-${color}`;
    this.button.title = `Annotation color: ${color}`;
    this.button.setAttribute("aria-label", this.button.title);
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible;
    if (!visible && this.button.getAttribute("aria-expanded") === "true") { closePopover(); }
  }

  private open(): void {
    const menu = renderElement("div", { class: "rd-menu", role: "menu", "aria-label": "Annotation color" });
    for (const color of ANNOTATION_COLORS) {
      const item = renderElement("button", { class: "rd-menu-item", type: "button", role: "menuitemradio", "aria-checked": String(color === this.color) },
        renderElement("span", { class: `rd-annotation-swatch rd-color-${color}`, "aria-hidden": "true" }), color);
      item.addEventListener("click", () => { this.setColor(color); this.select(color); closePopover(); this.button.focus({ preventScroll: true }); });
      menu.append(item);
    }
    openMenuPopover(this.button, menu, "below");
  }
}

/** Shows `menu` anchored to `anchor`: a click in it keeps the page selection, and Escape closes it and gives the focus back to `anchor`. */
export function openMenuPopover(anchor: HTMLElement, menu: HTMLElement, placement: "below" | "above"): void {
  menu.addEventListener("mousedown", (event) => event.preventDefault());
  menu.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") { return; }
    event.stopPropagation();
    closePopover();
    anchor.focus({ preventScroll: true });
  });
  updatePopoverOpen(anchor, menu, placement);
}

// Shows a strip of tabs where arrow keys, Home and End move the selection with a roving tabindex.
/** One tab: its id, its visible label and the id of the panel it shows, when it has one. */
export interface TabSpec<T extends string> {
  id: T;
  label: string;
  controls?: string;
}

interface TabListOptions<T extends string> {
  /** The accessible name of the strip. */
  label: string;
  onSelect: (id: T) => void;
  /** The tab selected at first; the first tab when absent. */
  selected?: T;
}

export class TabList<T extends string> {
  readonly el: HTMLElement;
  private readonly buttons: HTMLButtonElement[];
  private current: number;

  constructor(private readonly tabs: ReadonlyArray<TabSpec<T>>, private readonly options: TabListOptions<T>) {
    this.el = renderElement("div", { class: "rd-tabs", role: "tablist", "aria-label": options.label });
    this.buttons = tabs.map(({ id, label, controls }) => {
      const button = renderElement("button", { class: "rd-tab", type: "button", role: "tab", text: label });
      if (controls !== undefined) { button.setAttribute("aria-controls", controls); }
      button.addEventListener("click", () => this.select(id));
      return button;
    });
    this.current = Math.max(0, tabs.findIndex((t) => t.id === options.selected));
    this.el.append(...this.buttons);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.mark();
  }

  get selected(): T { return this.tabs[this.current]!.id; }

  /** @returns the button of the tab `id`, for callers that relabel or restyle it. */
  button(id: T): HTMLButtonElement { return this.buttons[this.indexOf(id)]!; }

  /** Selects the tab `id` and reports it; `focus` also moves keyboard focus onto it. */
  select(id: T, focus = false): void {
    this.current = this.indexOf(id);
    this.mark();
    if (focus) { this.buttons[this.current]!.focus(); }
    this.options.onSelect(id);
  }

  private indexOf(id: T): number { return this.tabs.findIndex((t) => t.id === id); }

  private mark(): void {
    this.buttons.forEach((button, i) => {
      button.setAttribute("aria-selected", String(i === this.current));
      button.tabIndex = i === this.current ? 0 : -1;
    });
  }

  private onKey(e: KeyboardEvent): void {
    const last = this.tabs.length - 1;
    const step: Record<string, number> = { ArrowRight: this.current + 1, ArrowLeft: this.current - 1, Home: 0, End: last };
    const target = step[e.key];
    if (target === undefined) { return; }
    e.preventDefault();
    const wrapped = target < 0 ? last : target > last ? 0 : target;
    this.select(this.tabs[wrapped]!.id, true);
  }
}
