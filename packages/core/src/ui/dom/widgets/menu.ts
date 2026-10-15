/**
 * Shows context and dropdown menus after VS Code's: at a point or under an anchor, clamped to the viewport, closed by an
 * outside click or Escape, arrow keys to move; one at a time, on document.body or inside a shadow root.
 */
import { escapeHtml } from "../../escapeHtml.js";
import { icon, type IconName } from "../../icons/index.js";
import { el } from "../dom.js";

export interface MenuItem {
  label: string;
  icon?: IconName;
  /** Trusted markup shown where the icon goes, such as a status dot; `icon` wins when both are set. */
  lead?: string;
  /** Shows a check mark in the icon's place. */
  checked?: boolean;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}
export type MenuEntry = MenuItem | "separator";

export interface MenuAnchor { x: number; y: number }

export interface MenuOptions {
  /** Where to mount the menu; it must already carry the kit's styles. Defaults to document.body. */
  root?: ShadowRoot;
}

let closeCurrent: (() => void) | null = null;

/** Closes whichever menu is open, if any. */
export function closeMenu(): void {
  closeCurrent?.();
}

/** Opens a menu at a point (right-click) or below an anchor element (dropdown). */
export function showMenu(anchor: MenuAnchor | HTMLElement, entries: MenuEntry[], opts: MenuOptions = {}): void {
  closeMenu();

  const menu = el("div", { class: "ls-menu", role: "menu" });
  for (const entry of entries) {
    if (entry === "separator") { menu.append(el("div", { class: "ls-menu-sep", role: "separator" })); continue; }
    const item = el("button", {
      class: `ls-menu-item${entry.danger ? " danger" : ""}${entry.checked ? " checked" : ""}`,
      role: entry.checked === undefined ? "menuitem" : "menuitemcheckbox",
      "aria-checked": entry.checked === undefined ? undefined : String(entry.checked),
      type: "button",
      disabled: entry.disabled ? true : undefined,
      html: `<span class="ls-menu-lead">${leadOf(entry)}</span><span class="ls-menu-label">${escapeHtml(entry.label)}</span>${entry.hint ? `<span class="hint">${escapeHtml(entry.hint)}</span>` : ""}`,
    });
    item.addEventListener("click", () => { close(); entry.onSelect(); });
    menu.append(item);
  }

  const scrim = el("div", { class: "ls-scrim" });
  scrim.addEventListener("mousedown", close);
  scrim.addEventListener("contextmenu", (e) => { e.preventDefault(); close(); });
  (opts.root ?? document.body).append(scrim, menu);
  const focusScope: DocumentOrShadowRoot = opts.root ?? document;

  const point = anchor instanceof HTMLElement ? anchorPoint(anchor) : anchor;
  place(menu, point, anchor instanceof HTMLElement ? anchor.getBoundingClientRect().height : 0);

  const onKey = (e: KeyboardEvent): void => {
    const items = Array.from(menu.querySelectorAll<HTMLButtonElement>(".ls-menu-item:not(:disabled)"));
    const idx = items.indexOf(focusScope.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Tab") { e.preventDefault(); }
  };
  document.addEventListener("keydown", onKey, true);
  menu.querySelector<HTMLButtonElement>(".ls-menu-item:not(:disabled)")?.focus();

  function close(): void {
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    menu.remove();
    if (closeCurrent === close) closeCurrent = null;
  }
  closeCurrent = close;
}

function leadOf(entry: MenuItem): string {
  if (entry.checked) return icon("check");
  return entry.icon ? icon(entry.icon) : entry.lead ?? "";
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
