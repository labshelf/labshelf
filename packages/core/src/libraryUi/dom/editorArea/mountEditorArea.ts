// Mounts the editor area: tabs in up to two groups side by side, bodies mounted on first activation and disposed on close.
import { el } from "../../../ui/dom/index.js";
import { EditorGroups, otherGroup } from "./editorGroups.js";
import { createEditorSash } from "./editorSash.js";
import { wireTabDrag } from "./tabDrag.js";
import { wireTabKeys } from "./tabKeys.js";
import { showTabMenu } from "./tabMenu.js";
import type { EditorArea, EditorAreaOptions } from "./types.js";

/** Builds the area inside `slot`; the area is empty until the host opens a tab. */
export function mountEditorArea(slot: HTMLElement, options: EditorAreaOptions = {}): EditorArea {
  const root = el("div", { class: "ls-editor-area" });
  // The sash needs the first group's element and the groups need the sash's layout, so the groups call it late.
  let layoutSash = (_split: boolean): void => {};
  const state = new EditorGroups(options, (split) => { root.classList.toggle("split", split); layoutSash(split); });
  const [first, second] = state.groups;
  const sash = createEditorSash(root, first.el, options.prefs);
  layoutSash = sash.layout;
  root.append(first.el, sash.el, second.el);
  slot.append(root);

  async function close(id: string): Promise<boolean> {
    if (!state.has(id)) return false;
    if ((await options.onClose?.(id)) === false) return false;
    state.remove(id);
    return true;
  }
  const closeLater = (id: string): void => { void close(id); };
  const menu = (id: string, at: HTMLElement | { x: number; y: number }): void => showTabMenu(at, {
    close: () => closeLater(id),
    moveToOtherGroup: () => { if (state.has(id)) state.move(id, otherGroup(state.groupOf(id).index)); },
  });

  wirePointer(root, { focus: (id) => state.focus(id, true), close: closeLater, menu });
  wireTabDrag(root, state.groups, (id, group) => state.move(id, group));
  wireTabKeys(root, {
    focusedId: () => state.focusedId(),
    focusedOrder: () => state.focusedOrder(),
    orderOf: (id) => state.groupOf(id).order,
    focus: (id, moveDomFocus) => state.focus(id, moveDomFocus),
    close: closeLater,
    menu: (id) => menu(id, state.tabEl(id)),
  });

  return {
    open: (tab, group, how) => state.open(tab, group, how?.background === true),
    close,
    activate: (id) => state.focus(id),
    refreshActions: (id) => state.refreshActions(id),
    tabs: () => state.tabs(),
    split: () => { const id = state.focusedId(); if (id) state.move(id, otherGroup(state.groupOf(id).index)); },
    dispose: () => { state.disposeAll(); root.remove(); },
  };
}

interface PointerActions {
  focus(id: string): void;
  close(id: string): void;
  menu(id: string, at: { x: number; y: number }): void;
}

// A click focuses a tab, its close button or a middle click closes it, and a right-click opens its menu.
function wirePointer(root: HTMLElement, a: PointerActions): void {
  const tabId = (e: Event): string | null => (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]')?.dataset.tabId ?? null;
  root.addEventListener("click", (e) => {
    const id = tabId(e);
    if (!id) return;
    if ((e.target as HTMLElement).closest(".ls-editor-tab-close")) a.close(id);
    else a.focus(id);
  });
  root.addEventListener("auxclick", (e) => {
    const id = tabId(e);
    if (id && e.button === 1) { e.preventDefault(); a.close(id); }
  });
  root.addEventListener("contextmenu", (e) => {
    const id = tabId(e);
    if (!id) return;
    e.preventDefault();
    a.menu(id, { x: e.clientX, y: e.clientY });
  });
}
