/**
 * Runs the list keymap on key presses anywhere on the page, except while an overlay or the citation map is open, inside
 * a text field, inside the host's sidebar (it has its own keys) or when Enter/Space activates a focused button.
 */
import { parentDir } from "../../../library/index.js";
import { listKeyAction, type ListKeyAction } from "../../listKeymap.js";
import { confirmRemove, copyCitation, openPaper, setPaperStatus } from "../flows/index.js";
import { showPaperMenu } from "../menu/index.js";
import { overlayOpen, type ListCursor, type UiContext } from "../uiContext.js";
import { collapseOrLeave, expandOrEnter, focusedChildRow, paperRowOf } from "./tree/index.js";

// The menu key opens the menu of the focused file row, or the paper menu under the cursor row, a little in from its left edge.
function openMenuAtCursor(ctx: UiContext): void {
  const child = focusedChildRow(ctx.root);
  if (child) {
    const c = child.getBoundingClientRect();
    child.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: c.left + 40, clientY: c.bottom }));
    return;
  }
  const { cursor, selected } = ctx.store.get();
  const row = paperRowOf(ctx.root, cursor);
  if (!row || selected.size === 0) return;
  const r = row.getBoundingClientRect();
  showPaperMenu(ctx, { x: r.left + 40, y: r.bottom });
}

function ignored(e: KeyboardEvent, ctx: UiContext): boolean {
  const active = document.activeElement as HTMLElement | null;
  // An overlay that took the key (Escape closing a menu) has already handled it.
  if (overlayOpen() || e.defaultPrevented || ctx.store.get().citationMap) return true;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return true;
  if (active && ctx.root.querySelector(".sidebar")?.contains(active)) return true;
  return !!active && active.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ");
}

/** Performs a list action; returns false when the key should keep its default behaviour. */
function perform(ctx: UiContext, cursor: ListCursor, action: ListKeyAction): boolean {
  const s = ctx.store.get();
  switch (action.kind) {
    case "focusSearch": ctx.focusSearch(true); return true;
    case "step": cursor.step(action.delta, action.extend); return true;
    case "page": cursor.page(action.dir, action.extend); return true;
    case "edge": cursor.edge(action.to); return true;
    case "parent": if (s.folder.includes("/")) ctx.store.openFolder(parentDir(s.folder, "/")); return true;
    case "open": {
      // A child row acts as its own click does, so each kind of child row decides what opening it means.
      const child = focusedChildRow(ctx.root);
      if (child) child.click(); else if (s.cursor) openPaper(ctx, s.cursor);
      return true;
    }
    case "expand": return expandOrEnter(ctx.root, s.cursor);
    case "collapse": return collapseOrLeave(ctx.root, s.cursor);
    case "escape":
      if (s.query) ctx.store.set({ query: "" });
      else ctx.store.clearSelection();
      return true;
    case "selectAll": ctx.store.set({ selected: new Set(cursor.order()) }); return true;
    case "setStatus": setPaperStatus(ctx, [...s.selected], action.status); return true;
    case "remove": if (s.selected.size) void confirmRemove(ctx, [...s.selected]); return true;
    case "copyKeys":
      // A text selection copies as text; the keys are copied only when nothing is selected on the page.
      if (s.selected.size === 0 || window.getSelection()?.toString()) return false;
      copyCitation(ctx, [...s.selected], "key");
      return true;
    case "menu": openMenuAtCursor(ctx); return true;
    case "typeToSearch":
      // Focus moves before the key lands, so the character types into the search box.
      ctx.focusSearch();
      return false;
  }
}

/** Starts listening for list keys; returns the function that stops it. */
export function attachListKeys(ctx: UiContext, cursor: ListCursor): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (ignored(e, ctx)) return;
    const action = listKeyAction({ key: e.key, code: e.code, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    if (action && perform(ctx, cursor, action)) e.preventDefault();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}
