// Draws the open project's panel: the project's name, then titled sections of choices, opened from its sidebar row.
import { renderElement, showPopover } from "../../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../../ui/index.js";

export interface ProjectPanelItem {
  label: string;
  icon?: IconName;
  run(): void;
}

export interface ProjectPanelSection {
  title: string;
  /** "chips" lays the items out as small buttons side by side, for parallel choices such as file formats. */
  layout?: "chips";
  items: readonly ProjectPanelItem[];
}

export interface ProjectPanel {
  name: string;
  /** Under the name, such as the format and the main file. */
  detail?: string;
  sections: readonly ProjectPanelSection[];
  /** Destructive choices, set apart at the bottom. */
  danger?: readonly ProjectPanelItem[];
}

function itemButton(item: ProjectPanelItem, className: string, close: () => void): HTMLElement {
  const button = renderElement("button", { type: "button", class: className, html: item.icon ? renderIcon(item.icon) : "" });
  button.append(renderElement("span", { text: item.label }));
  button.addEventListener("click", () => { close(); item.run(); });
  return button;
}

function renderSection(section: ProjectPanelSection, close: () => void): HTMLElement {
  const chips = section.layout === "chips";
  const body = renderElement("div", { class: chips ? "ls-project-panel-chips" : "ls-project-panel-list" });
  for (const item of section.items) body.append(itemButton(item, chips ? "ls-project-panel-chip" : "ls-project-panel-item", close));
  return renderElement("section", { class: "ls-project-panel-section" },
    renderElement("h3", { class: "ls-project-panel-title", text: section.title }), body);
}

/** Opens the panel below the project's row; empty sections are left out. */
export function showProjectPanel(anchor: HTMLElement, panel: ProjectPanel): void {
  showPopover(anchor, (close) => {
    const el = renderElement("div", { class: "ls-project-panel", role: "dialog", "aria-label": `${panel.name} options` });
    const head = renderElement("header", { class: "ls-project-panel-head" }, renderElement("div", { class: "ls-project-panel-name", text: panel.name }));
    if (panel.detail) head.append(renderElement("div", { class: "ls-project-panel-detail", text: panel.detail }));
    el.append(head);
    for (const section of panel.sections) if (section.items.length > 0) el.append(renderSection(section, close));
    if (panel.danger && panel.danger.length > 0) {
      const foot = renderElement("footer", { class: "ls-project-panel-danger" });
      for (const item of panel.danger) foot.append(itemButton(item, "ls-project-panel-item danger", close));
      el.append(foot);
    }
    // The panel matches the row it opens from, so it reads as that project's options rather than a context menu.
    el.style.width = `${Math.max(260, anchor.getBoundingClientRect().width)}px`;
    return el;
  });
}
