/**
 * Runs the list keymap on key presses anywhere on the page, except while an overlay is open, inside a text field,
 * inside the host's sidebar (it has its own keys) or when Enter/Space activates a focused button.
 */
import { parentDir } from "../../../library/index.js";
import { listKeyAction, type ListKeyAction } from "../../listKeymap.js";
import { confirmRemove, copyCiteKeys, openPaper, setPaperStatus } from "../flows/index.js";
import { overlayOpen, type UiContext } from "../uiContext.js";

export interface ListCursor {
  /** Ids of the rows as shown. */
  order(): readonly string[];
  /** Moves the cursor by `delta` rows (from the edge when there is none), extending the selection when asked. */
  step(delta: 1 | -1, extend: boolean): void;
}

function ignored(e: KeyboardEvent, ctx: UiContext): boolean {
  const active = document.activeElement as HTMLElement | null;
  if (overlayOpen()) return true;
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
    case "edge": ctx.store.set({ cursor: null }); cursor.step(action.to === "first" ? 1 : -1, false); return true;
    case "parent": if (s.folder.includes("/")) ctx.store.openFolder(parentDir(s.folder, "/")); return true;
    case "open": if (s.cursor) openPaper(ctx, s.cursor); return true;
    case "escape": if (s.query || s.status !== "all") ctx.store.set({ status: "all", query: "" }); else ctx.store.clearSelection(); return true;
    case "selectAll": ctx.store.set({ selected: new Set(cursor.order()) }); return true;
    case "setStatus": setPaperStatus(ctx, [...s.selected], action.status); return true;
    case "remove": if (s.selected.size) void confirmRemove(ctx, [...s.selected]); return true;
    case "copyKeys":
      // A text selection copies as text; the keys are copied only when nothing is selected on the page.
      if (s.selected.size === 0 || window.getSelection()?.toString()) return false;
      copyCiteKeys(ctx, [...s.selected]);
      return true;
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
