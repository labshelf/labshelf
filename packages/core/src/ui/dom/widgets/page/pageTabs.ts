// Builds a tablist that switches a tabpanel, with manual activation and roving tabindex.
import { el } from "../../dom.js";
import { moveTabFocus } from "./tablistFocus.js";

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
  const list = el("div", { class: "ls-page-tabs", role: "tablist", "aria-label": opts.label });
  panel.setAttribute("role", "tabpanel");
  const buttons = opts.tabs.map((tab) => {
    const b = el("button", { class: "ls-page-tab", type: "button", role: "tab", id: `${panel.id}-tab-${tab.id}`, "aria-controls": panel.id, text: tab.label });
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
