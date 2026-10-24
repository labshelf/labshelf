// Keeps the open tabs of the two editor groups: which group holds each, which one each group shows and which group has focus.
import { el } from "../../../ui/dom/index.js";
import { createEditorActionsBar, type EditorActionsBar } from "./actions/index.js";
import { createTabEntry, paintTab, selectTab, type TabEntry } from "./editorTab.js";
import type { EditorAreaOptions, EditorGroupIndex, EditorTab, EditorTabAction, EditorTabInfo } from "./types.js";

export interface EditorGroup {
  index: EditorGroupIndex;
  el: HTMLElement;
  tablist: HTMLElement;
  panels: HTMLElement;
  actions: EditorActionsBar;
  order: string[];
  active: string | null;
}

export const otherGroup = (g: EditorGroupIndex): EditorGroupIndex => (g === 0 ? 1 : 0);

function createGroup(index: EditorGroupIndex): EditorGroup {
  const tablist = el("div", { class: "ls-editor-tabs", role: "tablist", "aria-label": index === 0 ? "Editors" : "Editors, second group" });
  const panels = el("div", { class: "ls-editor-panels" });
  const actions = createEditorActionsBar();
  const group = el("section", { class: "ls-editor-group", hidden: true }, el("div", { class: "ls-editor-titlebar" }, tablist, actions.el), panels);
  group.dataset.group = String(index);
  return { index, el: group, tablist, panels, actions, order: [], active: null };
}

const NO_ACTIONS: readonly EditorTabAction[] = [];

type Events = Pick<EditorAreaOptions, "onActivate" | "onMove" | "trailing">;

export class EditorGroups {
  readonly groups = [createGroup(0), createGroup(1)] as const;
  private readonly entries = new Map<string, TabEntry>();
  private focusedGroup: EditorGroupIndex = 0;

  /** `layout` runs whenever a group gains its first tab or loses its last. */
  constructor(private readonly events: Events, private readonly layout: (split: boolean) => void) {}

  has(id: string): boolean { return this.entries.has(id); }
  focusedId(): string | null { return this.groups[this.focusedGroup].active; }
  focusedOrder(): readonly string[] { return this.groups[this.focusedGroup].order; }
  groupOf(id: string): EditorGroup { return this.groups[this.entry(id).tab.group]; }
  tabEl(id: string): HTMLElement { return this.entry(id).tabEl; }

  open(tab: EditorTab, group?: EditorGroupIndex, background = false): void {
    const existing = this.entries.get(tab.id);
    if (!existing) {
      const created = createTabEntry(tab);
      this.entries.set(tab.id, created);
      this.attach(created, group ?? tab.group);
      this.relayout();
      const g = this.groups[created.tab.group];
      if (!background) this.focus(tab.id);
      else if (!g.active) this.reveal(g, tab.id);
      return;
    }
    existing.tab = { ...tab, group: existing.tab.group };
    paintTab(existing);
    selectTab(existing, this.groupOf(tab.id).active === tab.id);
    if (group !== undefined && group !== existing.tab.group) this.move(tab.id, group);
    else this.focus(tab.id);
  }

  refreshActions(id: string): void {
    const e = this.entries.get(id);
    if (!e?.body || this.groupOf(id).active !== id) return;
    this.groupOf(id).actions.render(e.body.actions ?? NO_ACTIONS);
  }

  focus(id: string, moveDomFocus = false): void {
    const e = this.entry(id);
    this.focusedGroup = e.tab.group;
    this.reveal(this.groups[e.tab.group], id);
    if (moveDomFocus) e.tabEl.focus();
    this.events.onActivate?.(id);
  }

  move(id: string, target: EditorGroupIndex): void {
    const e = this.entry(id);
    if (e.tab.group === target) return;
    this.detach(e);
    this.attach(e, target);
    this.relayout();
    this.focus(id);
    this.events.onMove?.(id, target);
  }

  /** Removes the tab and disposes its body; the caller has already asked the host. */
  remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    const wasFocused = this.detach(e);
    this.entries.delete(id);
    e.tabEl.remove();
    e.panel.remove();
    e.body?.dispose();
    this.relayout();
    if (!wasFocused) return;
    const g = this.groups[this.focusedGroup].active ? this.groups[this.focusedGroup] : this.groups[otherGroup(this.focusedGroup)];
    if (g.active) this.focus(g.active);
  }

  tabs(): EditorTabInfo[] {
    return this.groups.flatMap((g) => g.order.map((id) => {
      const { tab } = this.entry(id);
      const active = g.active === id;
      return { id, title: tab.title, group: g.index, dirty: tab.dirty === true, active, focused: active && g.index === this.focusedGroup };
    }));
  }

  disposeAll(): void {
    for (const e of this.entries.values()) e.body?.dispose();
    this.entries.clear();
  }

  private entry(id: string): TabEntry {
    const found = this.entries.get(id);
    if (!found) throw new Error(`Editor area: no open tab "${id}"`);
    return found;
  }

  private relayout(): void {
    for (const g of this.groups) g.el.hidden = g.order.length === 0;
    const rightMost = this.groups.filter((g) => !g.el.hidden).pop();
    if (rightMost && this.events.trailing) rightMost.el.querySelector(".ls-editor-titlebar")?.append(this.events.trailing);
    this.layout(this.groups.every((g) => !g.el.hidden));
  }

  // Shows `id` in its group, mounting its body the first time it shows.
  private reveal(g: EditorGroup, id: string): void {
    g.active = id;
    for (const each of g.order) selectTab(this.entry(each), each === id);
    const shown = this.entry(id);
    shown.body ??= shown.tab.mount(shown.panel);
    g.actions.render(shown.body.actions ?? NO_ACTIONS);
  }

  // Takes the tab out of its group and shows a neighbour there; returns whether it was the focused tab.
  private detach(e: TabEntry): boolean {
    const g = this.groups[e.tab.group];
    const at = g.order.indexOf(e.tab.id);
    const wasFocused = g.index === this.focusedGroup && g.active === e.tab.id;
    g.order.splice(at, 1);
    if (g.active !== e.tab.id) return wasFocused;
    g.active = null;
    const next = g.order[at] ?? g.order[at - 1];
    if (next) this.reveal(g, next);
    else g.actions.render(NO_ACTIONS);
    return wasFocused;
  }

  private attach(e: TabEntry, target: EditorGroupIndex): void {
    const g = this.groups[target];
    e.tab = { ...e.tab, group: target };
    g.order.push(e.tab.id);
    g.tablist.append(e.tabEl);
    g.panels.append(e.panel);
  }
}
