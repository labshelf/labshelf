// Page-level widgets: tabs, segmented filter, progress mark, section card, empty notice, member chip and planned notice.
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement } from "../dom.js";
import { renderArcMarkElement } from "./arcMark.js";

export interface PageTabsOptions {
  label: string;
  tabs: readonly { id: string; label: string }[];
  selected: string;
  onSelect(id: string): void;
}

export interface PageTabs {
  el: HTMLElement;
  select(id: string): void;
}

/** `panel` is the tabpanel the tabs control; it needs an id. */
export function mountPageTabs(panel: HTMLElement, opts: PageTabsOptions): PageTabs {
  const list = renderElement("div", { class: "ls-page-tabs", role: "tablist", "aria-label": opts.label });
  panel.setAttribute("role", "tabpanel");
  const buttons = opts.tabs.map((tab) => {
    const b = renderElement("button", { class: "ls-page-tab", type: "button", role: "tab", id: `${panel.id}-tab-${tab.id}`, "aria-controls": panel.id, text: tab.label });
    b.dataset.tab = tab.id;
    return b;
  });
  list.append(...buttons);
  const select = (id: string): void => {
    for (const b of buttons) {
      const on = b.dataset.tab === id;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) panel.setAttribute("aria-labelledby", b.id);
    }
  };
  select(opts.selected);
  const choose = (id: string): void => { select(id); opts.onSelect(id); };
  list.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (b) choose(b.dataset.tab!);
  });
  list.addEventListener("keydown", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!b || moveTabFocus(list, b, e)) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(b.dataset.tab!);
    }
  });
  return { el: list, select };
}

export function moveTabFocus(list: HTMLElement, current: HTMLElement, e: KeyboardEvent): boolean {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return false;
  e.preventDefault();
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const at = tabs.indexOf(current);
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (at + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  return true;
}

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
}

export interface SegmentedFilterOptions {
  label: string;
  options: readonly FilterOption[];
  selected: string;
  onSelect(id: string): void;
}

export function renderSegmentedFilter(opts: SegmentedFilterOptions): HTMLElement {
  const group = renderElement("div", { class: "ls-segmented", role: "group", "aria-label": opts.label });
  const buttons = opts.options.map((o) => {
    const b = renderElement("button", { class: "ls-segmented-option", type: "button" }, o.label,
      o.count === undefined ? null : renderElement("span", { class: "ls-segmented-count", text: String(o.count) }));
    b.addEventListener("click", () => {
      mark(o.id);
      opts.onSelect(o.id);
    });
    return b;
  });
  const mark = (id: string): void => {
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(opts.options[i]!.id === id)));
  };
  mark(opts.selected);
  group.append(...buttons);
  return group;
}

export function renderProgressMark(done: number, total: number, label?: string): HTMLElement {
  const complete = total > 0 && done >= total;
  const progress = complete ? "full" : done === 0 ? "none" : "half";
  return renderArcMarkElement(complete ? "ok" : "accent", progress, label ?? `${done} of ${total} Done`);
}

export interface SectionCardOptions {
  title: string;
  icon?: IconName;
  actions?: HTMLElement[];
  body: Node;
}

let nextId = 0;

export function renderSectionCard(opts: SectionCardOptions): HTMLElement {
  const id = `ls-card-title-${++nextId}`;
  const head = renderElement("div", { class: "ls-card-head" },
    opts.icon ? renderElement("span", { class: "ls-card-icon", "aria-hidden": "true", html: renderIcon(opts.icon) }) : null, renderElement("h2", { id, text: opts.title }),
    opts.actions?.length ? renderElement("div", { class: "ls-card-actions" }, ...opts.actions) : null);
  return renderElement("section", { class: "ls-card", "aria-labelledby": id }, head, opts.body);
}

export interface EmptyNoticeOptions {
  text: string;
  hint?: string;
  icon?: IconName;
  action?: { label: string; icon?: IconName; primary?: boolean; onClick(): void };
  /** Left-aligned and iconless, for use inside a card. */
  inline?: boolean;
}

export function renderEmptyNotice(o: EmptyNoticeOptions): HTMLElement {
  const box = renderElement("div", { class: o.inline ? "ls-empty ls-empty-inline" : "ls-empty" });
  if (o.icon && !o.inline) box.append(renderElement("div", { class: "ls-empty-icon", html: renderIcon(o.icon) }));
  box.append(renderElement("div", { class: "ls-empty-text", text: o.text }));
  if (o.action) {
    const a = o.action;
    const button = renderElement("button", { class: a.primary ? "ls-btn ls-btn-primary" : "ls-btn", type: "button" });
    if (a.icon) button.insertAdjacentHTML("beforeend", renderIcon(a.icon));
    button.append(renderElement("span", { text: a.label }));
    button.addEventListener("click", a.onClick);
    box.append(button);
  }
  if (o.hint) box.append(renderElement("div", { class: "ls-empty-hint", text: o.hint }));
  return box;
}

export function renderMemberChip(name: string): HTMLElement {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
  return renderElement("span", { class: "ls-member", role: "img", "aria-label": name, title: name, text: initials });
}

export function setPlannedNotice(control: HTMLElement, reason: string): void {
  control.setAttribute("aria-disabled", "true");
  control.title = reason;
  control.classList.add("ls-positioned");
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  control.addEventListener("click", swallow, true);
  control.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") swallow(e);
  }, true);
}
