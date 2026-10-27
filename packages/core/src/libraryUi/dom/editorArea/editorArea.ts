/**
 * Mounts the editor area: tab groups side by side with a sash, lazy tab bodies, a tab strip with the per-tab actions bar and
 * overflow menu, and the mount options and handle types the callers see.
 */
import { renderElement, showMenu, type MenuAnchor, renderIcon } from "../../../ui/dom/index.js";
import { EditorGroups, deriveOtherGroup, type EditorGroup } from "./editorGroups.js";
import { attachSash } from "../libraryChrome.js";
import type { IconName } from "../../../ui/icons/index.js";

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
  const sash = renderElement("div", { class: "ls-editor-sash", role: "separator", "aria-orientation": "vertical", title: "Drag to resize", hidden: true });
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
function wireTabDrag(root: HTMLElement, groups: readonly EditorGroup[], move: (id: string, group: EditorAreaSide) => void): void {
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
  const root = renderElement("div", { class: "ls-editor-area" });
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
    moveToOtherGroup: () => { if (state.has(id)) state.move(id, deriveOtherGroup(state.groupOf(id).index)); },
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
    split: () => { const id = state.focusedId(); if (id) state.move(id, deriveOtherGroup(state.groupOf(id).index)); },
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

export interface EditorActionsBar {
  el: HTMLElement;
  /** Shows `actions`, or hides the bar when there are none; the same array twice leaves the buttons in place. */
  render(actions: readonly EditorTabAction[]): void;
}

function actionButton(label: string, glyph: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const button = renderElement("button", { class: "ls-icon-btn ls-editor-action", type: "button", title: label, "aria-label": label, html: glyph });
  button.addEventListener("click", () => onClick(button));
  return button;
}

export function createEditorActionsBar(): EditorActionsBar {
  const bar = renderElement("div", { class: "ls-editor-actions", role: "toolbar", "aria-label": "Editor actions", hidden: true });
  let shown: readonly EditorTabAction[] | null = null;

  return {
    el: bar,
    render(actions) {
      if (actions === shown) return;
      shown = actions;
      const inline = actions.filter((a) => !a.overflow);
      const overflow = actions.filter((a) => a.overflow);
      const buttons = inline.map((a) => actionButton(a.label, renderIcon(a.icon), () => a.run()));
      if (overflow.length > 0) {
        buttons.push(actionButton("More Actions…", renderIcon("more"), (anchor) => {
          showMenu(anchor, overflow.map((a) => ({ label: a.label, icon: a.icon, onSelect: () => a.run() })));
        }));
      }
      bar.replaceChildren(...buttons);
      bar.hidden = buttons.length === 0;
    },
  };
}

export interface TabEntry {
  tab: EditorTab;
  tabEl: HTMLElement;
  panel: HTMLElement;
  body: EditorTabBody | null;
}

let nextId = 0;

/** Creates the tab and its hidden panel, linked for assistive technology. */
export function createTabEntry(tab: EditorTab): TabEntry {
  const uid = `ls-editor-${++nextId}`;
  const tabEl = renderElement("div", { class: "ls-editor-tab", role: "tab", id: `${uid}-tab`, "aria-controls": `${uid}-panel`, "aria-selected": "false", tabindex: -1, draggable: "true" });
  tabEl.dataset.tabId = tab.id;
  const panel = renderElement("div", { class: "ls-editor-panel", role: "tabpanel", id: `${uid}-panel`, "aria-labelledby": `${uid}-tab`, hidden: true });
  const entry = { tab, tabEl, panel, body: null };
  drawTab(entry);
  return entry;
}

/** Repaints the tab's icon, title and dirty mark from `entry.tab`. */
export function drawTab(entry: TabEntry): void {
  const { tab, tabEl } = entry;
  const close = renderElement("button", { class: "ls-editor-tab-close", type: "button", tabindex: -1, "aria-label": `Close ${tab.title}`, title: "Close", html: renderIcon("x") });
  tabEl.replaceChildren(
    renderElement("span", { class: "ls-editor-tab-icon", html: renderIcon(tab.icon) }),
    renderElement("span", { class: "ls-editor-tab-label", text: tab.title }),
    close,
  );
  tabEl.classList.toggle("dirty", tab.dirty === true);
  tabEl.title = tab.dirty ? `${tab.title} (unsaved)` : tab.title;
}

/** Marks the tab shown or not in its group; the shown tab is the group's one tab stop. */
export function setTabShown(entry: TabEntry, selected: boolean): void {
  entry.tabEl.setAttribute("aria-selected", String(selected));
  entry.tabEl.classList.toggle("active", selected);
  entry.tabEl.tabIndex = selected ? 0 : -1;
  entry.panel.hidden = !selected;
}

export type EditorAreaSide = 0 | 1;

export interface EditorTabAction {
  id: string;
  icon: IconName;
  /** Tooltip and accessible name. */
  label: string;
  run(): void;
  /** Goes into the group's "More Actions" menu instead of the toolbar, like VS Code's non-navigation groups. */
  overflow?: boolean;
}

export interface EditorTabBody {
  dispose(): void;
  /** Shown at the end of the tab strip while this tab is its group's active one; read on reveal and on `refreshActions`. */
  actions?: readonly EditorTabAction[];
}

export interface EditorTab {
  id: string;
  title: string;
  icon: IconName;
  group: EditorAreaSide;
  /** Shows the unsaved dot in place of the close button. */
  dirty?: boolean;
  /** Runs once, on the tab's first activation; the body's `dispose` runs when the tab closes. */
  mount(el: HTMLElement): EditorTabBody;
}

export interface EditorTabView {
  id: string;
  title: string;
  group: EditorAreaSide;
  dirty: boolean;
  /** Shown in its group. */
  active: boolean;
  /** The active tab of the group that has focus: the one tab Ctrl/Cmd+W closes. */
  focused: boolean;
}

/** Keeps the first group's width in pixels while two groups show, the way the frame keeps its pane widths. */
export interface EditorAreaPrefsPort {
  load(): number | null;
  save(width: number): void;
}

export interface EditorAreaOptions {
  /** Runs when the focused tab changes. */
  onActivate?(id: string): void;
  /** Runs before a tab closes; false, or a promise of false, keeps it open (a dirty tab whose save was cancelled). */
  onClose?(id: string): boolean | void | Promise<boolean | void>;
  onMove?(id: string, group: EditorAreaSide): void;
  prefs?: EditorAreaPrefsPort;
  /** Kept at the end of the titlebar of the right-most group that shows tabs, after the actions bar. */
  trailing?: HTMLElement;
}

export interface EditorArea {
  /**
   * Adds the tab to `group` (default `tab.group`) and focuses it; an open id updates its title, icon and dirty mark and
   * moves to `group` when given. `background` adds it unfocused (restoring tabs), unless its group shows nothing yet.
   */
  open(tab: EditorTab, group?: EditorAreaSide, how?: { background?: boolean }): void;
  /** Resolves false when the tab is not open or `onClose` kept it. */
  close(id: string): Promise<boolean>;
  activate(id: string): void;
  /** Repaints the toolbar from the body's current `actions` while `id` is its group's active tab, for a body that gets them after mount. */
  refreshActions(id: string): void;
  tabs(): EditorTabView[];
  /** Moves the focused tab to the other group. */
  split(): void;
  /** Disposes every mounted body and removes the area. */
  dispose(): void;
}
