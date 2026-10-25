// Mounts the editor area: tabs in up to two groups side by side, bodies mounted on first activation and disposed on close.
import { el, showMenu, type MenuAnchor } from "../../../ui/dom/index.js";
import { EditorGroups, otherGroup, type EditorGroup } from "./editorGroups.js";
import type { EditorArea, EditorAreaOptions, EditorGroupIndex, EditorAreaPrefsPort } from "./editorAreaOptions.js";
import { attachSash } from "../shell/index.js";

// Handles the editor area's keys: roving focus inside a tablist, Ctrl/Cmd+W to close, Ctrl+Tab to cycle, and the tab menu key.
interface TabKeyActions {
  /** The focused tab of the focused group, if any. */
  focusedId(): string | null;
  /** The ids of the focused group, in tab order. */
  focusedOrder(): readonly string[];
  /** The ids of the group that holds `id`, in tab order. */
  orderOf(id: string): readonly string[];
  focus(id: string, moveDomFocus: boolean): void;
  close(id: string): void;
  menu(id: string): void;
}

const step = (order: readonly string[], id: string, by: number): string =>
  order[(order.indexOf(id) + by + order.length) % order.length]!;

function rovingTarget(key: string, order: readonly string[], id: string): string | null {
  if (key === "ArrowRight") return step(order, id, 1);
  if (key === "ArrowLeft") return step(order, id, -1);
  if (key === "Home") return order[0] ?? null;
  if (key === "End") return order[order.length - 1] ?? null;
  return null;
}

/** Listens on `root`; keys from inside a tab body bubble here too. */
function wireTabKeys(root: HTMLElement, a: TabKeyActions): void {
  root.addEventListener("keydown", (e) => {
    const current = a.focusedId();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "w") {
      if (!current) return;
      e.preventDefault();
      a.close(current);
      return;
    }
    if (e.ctrlKey && e.key === "Tab") {
      if (!current) return;
      e.preventDefault();
      a.focus(step(a.focusedOrder(), current, e.shiftKey ? -1 : 1), false);
      return;
    }
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab) return;
    const id = tab.dataset.tabId!;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); a.menu(id); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); a.focus(id, true); return; }
    const target = rovingTarget(e.key, a.orderOf(id), id);
    if (target) { e.preventDefault(); a.focus(target, true); }
  });
}

const MIN_GROUP_WIDTH = 160;

interface EditorSash {
  el: HTMLElement;
  /** Applies the saved width while both groups show; one group fills the area. */
  layout(split: boolean): void;
}

/** Wires the sash between `root`'s groups; `first` is the group it sizes. */
function createEditorSash(root: HTMLElement, first: HTMLElement, prefs: EditorAreaPrefsPort | undefined): EditorSash {
  const sash = el("div", { class: "ls-editor-sash", role: "separator", "aria-orientation": "vertical", title: "Drag to resize", hidden: true });
  let width = prefs?.load() ?? null;
  const apply = (split: boolean): void => {
    const sized = split && width !== null;
    first.style.width = sized ? `${width}px` : "";
    first.classList.toggle("sized", sized);
  };
  // Until the first drag both groups share the width equally; the drag starts from the width they have.
  sash.addEventListener("pointerdown", () => {
    if (width !== null) return;
    width = Math.round(first.getBoundingClientRect().width) || MIN_GROUP_WIDTH;
    apply(true);
  });
  attachSash(sash, {
    root, pane: first, collapsedClass: "never-collapsed",
    limits: { min: MIN_GROUP_WIDTH, max: Number.POSITIVE_INFINITY, collapseAt: Number.NEGATIVE_INFINITY },
    widthFromPointer: (x) => {
      const box = root.getBoundingClientRect();
      return Math.min(x - box.left, Math.max(MIN_GROUP_WIDTH, box.width - MIN_GROUP_WIDTH));
    },
    persist: (w) => { width = w; prefs?.save(w); },
  });
  return {
    el: sash,
    layout: (split) => { sash.hidden = !split; apply(split); },
  };
}

const TAB_MIME = "application/x-labshelf-editor-tab";

/** Wires dragging for every tab of `groups`; `move` runs on a drop onto the other group. */
function wireTabDrag(root: HTMLElement, groups: readonly EditorGroup[], move: (id: string, group: EditorGroupIndex) => void): void {
  root.addEventListener("dragstart", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab || !e.dataTransfer) return;
    e.dataTransfer.setData(TAB_MIME, tab.dataset.tabId!);
    e.dataTransfer.effectAllowed = "move";
    root.classList.add("tab-dragging");
  });
  root.addEventListener("dragend", () => {
    root.classList.remove("tab-dragging");
    groups.forEach((g) => g.el.classList.remove("drop-target"));
  });
  for (const g of groups) {
    g.el.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(TAB_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      g.el.classList.add("drop-target");
    });
    g.el.addEventListener("dragleave", (e) => {
      if (!g.el.contains(e.relatedTarget as Node | null)) g.el.classList.remove("drop-target");
    });
    g.el.addEventListener("drop", (e) => {
      const id = e.dataTransfer?.getData(TAB_MIME);
      if (!id) return;
      e.preventDefault();
      g.el.classList.remove("drop-target");
      move(id, g.index);
    });
  }
}

interface TabMenuActions {
  close(): void;
  moveToOtherGroup(): void;
}

/** Shows the menu at a pointer or under the tab. */
function showTabMenu(anchor: MenuAnchor | HTMLElement, actions: TabMenuActions): void {
  showMenu(anchor, [
    { label: "Close", icon: "x", hint: "Ctrl+W", onSelect: actions.close },
    { label: "Move to Other Group", icon: "open-to-side", onSelect: actions.moveToOtherGroup },
  ]);
}

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
