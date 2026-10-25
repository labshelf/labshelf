// Builds one editor tab and its panel and paints the tab's title, icon, dirty mark and selection.
import { renderElement, renderIcon } from "../../../ui/dom/index.js";
import type { EditorTab, EditorTabBody } from "./editorAreaOptions.js";

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
