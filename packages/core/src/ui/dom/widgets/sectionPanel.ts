// Draws a panel of titled sections under an anchor: an optional name on top, then each section's choices as a list or as chips side by side, and destructive choices set apart at the bottom.
import { renderIcon, type IconName } from "../../icons/index.js";
import { renderElement } from "../dom.js";
import { showPopover, type MenuAnchor, type MenuOptions } from "./menu.js";

export interface SectionPanelItem {
  label: string;
  icon?: IconName;
  /** A shortcut shown at the right of a list item. */
  hint?: string;
  /** Quieter text after the label, such as a count. */
  note?: string;
  /** A small icon button at the row's right edge that runs its own choice, such as removing the row. */
  action?: { icon: IconName; label: string; run(): void };
  disabled?: boolean;
  run(): void;
}

export interface SectionPanelSection {
  title: string;
  /** "chips" lays the items out as small buttons side by side, for parallel choices such as file formats. */
  layout?: "chips";
  items: readonly SectionPanelItem[];
}

export interface SectionPanel {
  /** The panel's name, such as what its choices act on, with `detail` under it. */
  name?: string;
  detail?: string;
  /** The panel's accessible name when it has no `name`. */
  label?: string;
  sections: readonly SectionPanelSection[];
  /** Destructive choices, set apart at the bottom. */
  danger?: readonly SectionPanelItem[];
  /** The panel's width in px, kept inside the window. */
  width?: number;
}

function itemButton(item: SectionPanelItem, className: string, close: () => void): HTMLElement {
  const button = renderElement("button", { type: "button", class: className, html: item.icon ? renderIcon(item.icon) : "", ...(item.disabled ? { disabled: true } : {}) });
  button.append(renderElement("span", { text: item.label }));
  if (item.note) button.append(renderElement("span", { class: "ls-section-panel-note", text: item.note }));
  if (item.hint) button.append(renderElement("kbd", { class: "ls-section-panel-hint", text: item.hint }));
  // Keeps the focus where it was (an editor's caret) until the choice runs.
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", () => { close(); item.run(); });
  return button;
}

/** A row with a button of its own beside the choice; buttons do not nest, so the two sit in one wrapper. */
function itemRow(item: SectionPanelItem, close: () => void): HTMLElement {
  if (!item.action) return itemButton(item, "ls-section-panel-item", close);
  const { icon, label, run } = item.action;
  const remove = renderElement("button", { type: "button", class: "ls-section-panel-action", title: label, "aria-label": label, html: renderIcon(icon) });
  remove.addEventListener("mousedown", (event) => event.preventDefault());
  remove.addEventListener("click", () => { close(); run(); });
  return renderElement("div", { class: "ls-section-panel-row" }, itemButton(item, "ls-section-panel-item", close), remove);
}

function renderSection(section: SectionPanelSection, close: () => void): HTMLElement {
  const chips = section.layout === "chips";
  const body = renderElement("div", { class: chips ? "ls-section-panel-chips" : "ls-section-panel-list" });
  for (const item of section.items) body.append(chips ? itemButton(item, "ls-section-panel-chip", close) : itemRow(item, close));
  return renderElement("section", { class: "ls-section-panel-section" },
    renderElement("h3", { class: "ls-section-panel-title", text: section.title }), body);
}

/** Opens `panel` under `anchor` (an element or a point); empty sections are left out. */
export function showSectionPanel(anchor: MenuAnchor | HTMLElement, panel: SectionPanel, opts: MenuOptions = {}): void {
  showPopover(anchor, (close) => {
    const el = renderElement("div", { class: "ls-section-panel", role: "dialog", "aria-label": panel.name ?? panel.label ?? "" });
    if (panel.name) {
      const head = renderElement("header", { class: "ls-section-panel-head" }, renderElement("div", { class: "ls-section-panel-name", text: panel.name }));
      if (panel.detail) head.append(renderElement("div", { class: "ls-section-panel-detail", text: panel.detail }));
      el.append(head);
    }
    for (const section of panel.sections) if (section.items.length > 0) el.append(renderSection(section, close));
    if (panel.danger && panel.danger.length > 0) {
      const foot = renderElement("footer", { class: "ls-section-panel-danger" });
      for (const item of panel.danger) foot.append(itemButton(item, "ls-section-panel-item danger", close));
      el.append(foot);
    }
    if (panel.width !== undefined) el.style.width = `${Math.min(window.innerWidth - 12, panel.width)}px`;
    return el;
  }, opts);
}
