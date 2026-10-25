// Paints the Details tab strip in the editor tab look and turns clicks and keys on it into tab actions.
import { renderElement, renderIcon, moveTabFocus, type IconName } from "../../../ui/dom/index.js";

/** One painted tab; `index` is the pinned tab's position, null for the preview. */
export interface StripTab {
  index: number | null;
  label: string;
  icon: IconName;
  active: boolean;
  /** Only the preview of a pinnable target shows a pin button. */
  pinnable: boolean;
}

export interface StripActions {
  select(index: number | null): void;
  pin(): void;
  close(index: number): void;
}

export interface TabStrip {
  el: HTMLElement;
  render(tabs: readonly StripTab[]): void;
}

function tabButton(cls: string, glyph: IconName, label: string, title: string): HTMLButtonElement {
  return renderElement("button", { class: cls, type: "button", tabindex: -1, "aria-label": label, title, html: renderIcon(glyph) });
}

function paintTab(tab: StripTab, panel: HTMLElement): HTMLElement {
  const preview = tab.index === null;
  const tabEl = renderElement("div", {
    class: `ls-editor-tab${tab.active ? " active" : ""}${preview ? " preview" : ""}`,
    id: `${panel.id}-${preview ? "preview" : tab.index}`, "aria-controls": panel.id,
    role: "tab", "aria-selected": String(tab.active), tabindex: tab.active ? 0 : -1, title: tab.label,
  },
  renderElement("span", { class: "ls-editor-tab-icon", html: renderIcon(tab.icon) }),
  renderElement("span", { class: "ls-editor-tab-label", text: tab.label }));
  tabEl.dataset.tab = preview ? "preview" : String(tab.index);
  if (preview && tab.pinnable) tabEl.append(tabButton("ls-editor-tab-close ls-details-tab-pin", "pin", `Pin ${tab.label}`, "Pin"));
  if (!preview) tabEl.append(tabButton("ls-editor-tab-close", "x", `Close ${tab.label}`, "Close"));
  return tabEl;
}

const indexOf = (tabEl: HTMLElement): number | null => (tabEl.dataset.tab === "preview" ? null : Number(tabEl.dataset.tab));

/** Arrow, Home and End keys move focus between tabs; Enter and Space activate the focused one. */
function onKey(list: HTMLElement, e: KeyboardEvent, actions: StripActions): void {
  const tabEl = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  if (!tabEl) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    actions.select(indexOf(tabEl));
    return;
  }
  moveTabFocus(list, tabEl, e);
}

function onClick(e: MouseEvent, actions: StripActions): void {
  const target = e.target as HTMLElement;
  const tabEl = target.closest<HTMLElement>('[role="tab"]');
  if (!tabEl) return;
  const index = indexOf(tabEl);
  if (target.closest(".ls-details-tab-pin")) actions.pin();
  else if (target.closest(".ls-editor-tab-close") && index !== null) actions.close(index);
  else actions.select(index);
}

/** `panel` is the tabpanel the tabs control; it needs an id. */
export function mountTabStrip(panel: HTMLElement, actions: StripActions): TabStrip {
  const list = renderElement("div", { class: "ls-editor-tabs", role: "tablist", "aria-label": "Details tabs" });
  const bar = renderElement("div", { class: "ls-editor-titlebar ls-details-tabbar" }, list);
  list.addEventListener("click", (e) => onClick(e, actions));
  list.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest('[data-tab="preview"]')) actions.pin();
  });
  list.addEventListener("keydown", (e) => onKey(list, e, actions));
  return {
    el: bar,
    render(tabs) {
      const hadFocus = list.contains(document.activeElement);
      list.replaceChildren(...tabs.map((tab) => paintTab(tab, panel)));
      bar.hidden = tabs.length === 0;
      const active = list.querySelector<HTMLElement>(".ls-editor-tab.active");
      if (active) panel.setAttribute("aria-labelledby", active.id);
      else panel.removeAttribute("aria-labelledby");
      if (hadFocus) (active ?? list.querySelector<HTMLElement>('[role="tab"]'))?.focus();
      active?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    },
  };
}
