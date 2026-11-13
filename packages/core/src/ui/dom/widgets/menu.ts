/**
 * Shows context and dropdown menus after VS Code's: at a point or under an anchor, clamped to the viewport, closed by an
 * outside click or Escape, arrow keys to move, focus handed back to the invoker; one at a time, on document.body, inside a
 * shadow root or inside an element of the page. An item can hold a submenu, opened beside it by hover, click or ArrowRight and closed by
 * ArrowLeft or Escape.
 */
import { escapeHtml } from "../../htmlSafety.js";
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement } from "../dom.js";

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Trusted markup shown where the icon goes, such as a status dot; `icon` wins when both are set. */
  lead?: string;
  /** Shows a check mark in the icon's place. */
  checked?: boolean;
  /** Marks a checked item as one choice of a group (role menuitemradio) instead of a toggle. */
  radio?: boolean;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Set as the item button's title, such as why a disabled item cannot be chosen. */
  title?: string;
  onSelect: () => void;
}
export type MenuEntry = MenuItem | "separator";
/** An item that opens its entries in a panel beside it instead of running. */
export interface SubmenuItem {
  label: string;
  icon?: IconName;
  /** Trusted markup shown where the icon goes, as on a MenuItem. */
  lead?: string;
  disabled?: boolean;
  submenu: MenuTreeEntry[];
}
/** What showMenu draws: the entries of a flat menu, and submenus. */
export type MenuTreeEntry = MenuEntry | SubmenuItem;

export interface MenuAnchor { x: number; y: number }

export interface MenuOptions {
  /** Where to mount the menu (a shadow root or an element of the page); it must already carry the kit's styles. Defaults to document.body. */
  root?: ShadowRoot | HTMLElement;
  /** Runs once when the menu closes, whatever closed it: a pick, Escape, an outside click or another menu opening. */
  onClose?: () => void;
}

let closeCurrent: (() => void) | null = null;

/** Closes whichever menu is open, if any. */
export function closeMenu(): void {
  closeCurrent?.();
}

/** Opens a menu at a point (right-click) or below an anchor element (dropdown). */
export function showMenu(anchor: MenuAnchor | HTMLElement, entries: MenuTreeEntry[], opts: MenuOptions = {}): void {
  mountOverlay(anchor, (close) => buildMenu(entries, close), (menu, scope, close) => menuKeyHandler(menu, scope, close), PANEL_ITEMS, opts);
}

/**
 * Opens a panel below an anchor, for choices richer than a list: placed, dismissed and focus-returned as a menu is.
 * `build` receives the close function, which a choice calls before it runs.
 */
export function showPopover(anchor: MenuAnchor | HTMLElement, build: (close: () => void) => HTMLElement, opts: MenuOptions = {}): void {
  mountOverlay(anchor, build, popoverKeyHandler, "button:not(:disabled)", opts);
}

type KeyHandlerOf = (el: HTMLElement, focusScope: DocumentOrShadowRoot, close: () => void) => (e: KeyboardEvent) => void;

function mountOverlay(anchor: MenuAnchor | HTMLElement, build: (close: () => void) => HTMLElement, keys: KeyHandlerOf, firstFocus: string, opts: MenuOptions): void {
  closeMenu();

  const menu = build(close);

  const scrim = renderElement("div", { class: "ls-scrim" });
  scrim.addEventListener("mousedown", close);
  scrim.addEventListener("contextmenu", (e) => { e.preventDefault(); close(); });
  (opts.root ?? document.body).append(scrim, menu);
  const focusScope: DocumentOrShadowRoot = opts.root instanceof ShadowRoot ? opts.root : document;

  const point = anchor instanceof HTMLElement ? anchorPoint(anchor) : anchor;
  place(menu, point, anchor instanceof HTMLElement ? anchor.getBoundingClientRect().height : 0);

  const onKey = keys(menu, focusScope, close);
  document.addEventListener("keydown", onKey, true);
  const invoker = focusScope.activeElement as HTMLElement | null;
  menu.querySelector<HTMLButtonElement>(firstFocus)?.focus();

  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    // INVARIANT: focus goes back before onSelect runs, so a dialog the item opens saves the invoker, not a removed item.
    const hadFocus = menu.contains(focusScope.activeElement);
    scrim.remove();
    menu.remove();
    if (hadFocus) invoker?.focus?.();
    if (closeCurrent === close) closeCurrent = null;
    opts.onClose?.();
  }
  closeCurrent = close;
}

/** Escape closes; Tab and the arrows cycle through the panel's buttons, so focus stays inside until it closes. */
function popoverKeyHandler(panel: HTMLElement, focusScope: DocumentOrShadowRoot, close: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const idx = buttons.indexOf(focusScope.activeElement as HTMLButtonElement);
    const step = (by: number): void => { e.preventDefault(); buttons[(idx + by + buttons.length) % buttons.length]?.focus(); };
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") step(e.shiftKey ? -1 : 1);
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
  };
}

/** The enabled items of one panel: its own buttons and its submenus' triggers, not the items inside those submenus. */
const PANEL_ITEMS = ":scope > .ls-menu-item:not(:disabled), :scope > .ls-menu-sub > .ls-menu-item:not(:disabled)";

function renderItem(entry: MenuItem | SubmenuItem, trailing: string): HTMLButtonElement {
  const checked = "checked" in entry ? entry.checked : undefined;
  const radio = "radio" in entry && entry.radio === true;
  return renderElement("button", {
    class: `ls-menu-item${"danger" in entry && entry.danger ? " danger" : ""}${checked ? " checked" : ""}`,
    role: checked === undefined ? "menuitem" : radio ? "menuitemradio" : "menuitemcheckbox",
    "aria-checked": checked === undefined ? undefined : String(checked),
    type: "button",
    disabled: entry.disabled ? true : undefined,
    title: "title" in entry ? entry.title : undefined,
    html: `<span class="ls-menu-lead">${leadOf(entry)}</span><span class="ls-menu-label">${escapeHtml(entry.label)}</span>${trailing}`,
  });
}

/** Shows `child` beside its trigger, on the left when the right has no room, and hides the other open submenus of the same panel. */
function openSubmenu(panel: HTMLElement, trigger: HTMLElement, child: HTMLElement): void {
  for (const open of panel.querySelectorAll<HTMLElement>(":scope > .ls-menu-sub > .ls-menu")) if (open !== child) closeSubmenu(open);
  if (!child.hidden) return;
  child.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const pad = 6;
  const item = trigger.getBoundingClientRect();
  const { width, height } = child.getBoundingClientRect();
  const right = item.right + 2;
  const x = right + width + pad <= window.innerWidth ? right : Math.max(pad, panel.getBoundingClientRect().left - width - 2);
  const y = Math.max(pad, Math.min(item.top - 5, window.innerHeight - height - pad));
  child.style.left = `${x}px`;
  child.style.top = `${y}px`;
}

function closeSubmenu(child: HTMLElement): void {
  for (const nested of child.querySelectorAll<HTMLElement>(".ls-menu")) nested.hidden = true;
  child.hidden = true;
  child.previousElementSibling?.setAttribute("aria-expanded", "false");
}

function closeSubmenusOf(panel: HTMLElement): void {
  for (const open of panel.querySelectorAll<HTMLElement>(":scope > .ls-menu-sub > .ls-menu")) closeSubmenu(open);
}

function buildPanel(entries: MenuTreeEntry[], close: () => void, root: boolean): HTMLElement {
  const panel = renderElement("div", { class: root ? "ls-menu" : "ls-menu ls-menu-child", role: "menu" });
  for (const entry of entries) {
    if (entry === "separator") { panel.append(renderElement("div", { class: "ls-menu-sep", role: "separator" })); continue; }
    if ("submenu" in entry) {
      const trigger = renderItem(entry, `<span class="hint ls-menu-more">${renderIcon("chevron-right")}</span>`);
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      const child = buildPanel(entry.submenu, close, false);
      child.hidden = true;
      const wrap = renderElement("div", { class: "ls-menu-sub" });
      wrap.append(trigger, child);
      trigger.addEventListener("mouseenter", () => openSubmenu(panel, trigger, child));
      trigger.addEventListener("click", () => { openSubmenu(panel, trigger, child); child.querySelector<HTMLElement>(PANEL_ITEMS)?.focus(); });
      panel.append(wrap);
      continue;
    }
    const item = renderItem(entry, entry.hint ? `<span class="hint">${escapeHtml(entry.hint)}</span>` : "");
    // Moving onto a plain item closes the panel's open submenu, as in a native menu.
    item.addEventListener("mouseenter", () => closeSubmenusOf(panel));
    item.addEventListener("click", () => { close(); entry.onSelect(); });
    panel.append(item);
  }
  return panel;
}

function buildMenu(entries: MenuTreeEntry[], close: () => void): HTMLElement {
  return buildPanel(entries, close, true);
}

function menuKeyHandler(menu: HTMLElement, focusScope: DocumentOrShadowRoot, close: () => void): (e: KeyboardEvent) => void {
  return (e) => {
    const focused = focusScope.activeElement as HTMLElement | null;
    // The panel that holds the focus: the menu itself or one of its open submenus.
    const panel = (focused && menu.contains(focused) ? focused.closest<HTMLElement>(".ls-menu") : null) ?? menu;
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>(PANEL_ITEMS));
    const idx = items.indexOf(focused as HTMLButtonElement);
    const parentTrigger = panel === menu ? null : panel.previousElementSibling as HTMLElement | null;
    const leave = (): void => { e.preventDefault(); closeSubmenu(panel); parentTrigger?.focus(); };
    if (e.key === "Escape") { if (parentTrigger) leave(); else { e.preventDefault(); close(); } }
    else if (e.key === "ArrowLeft" && parentTrigger) leave();
    else if (e.key === "ArrowRight" && focused?.getAttribute("aria-haspopup") === "menu") {
      e.preventDefault();
      const child = focused.nextElementSibling as HTMLElement;
      openSubmenu(panel, focused, child);
      child.querySelector<HTMLElement>(PANEL_ITEMS)?.focus();
    }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); }
  };
}

function leadOf(entry: MenuItem | SubmenuItem): string {
  if ("checked" in entry && entry.checked) return renderIcon("check");
  return entry.icon ? renderIcon(entry.icon) : entry.lead ?? "";
}

function anchorPoint(anchor: HTMLElement): MenuAnchor {
  const r = anchor.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

// Flips above / left of the anchor when the default placement would overflow the viewport.
function place(menu: HTMLElement, point: MenuAnchor, anchorHeight: number): void {
  const pad = 6;
  const { width, height } = menu.getBoundingClientRect();
  let x = point.x;
  let y = point.y;
  if (x + width + pad > window.innerWidth) x = Math.max(pad, window.innerWidth - width - pad);
  if (y + height + pad > window.innerHeight) y = Math.max(pad, point.y - height - anchorHeight - 4);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}
