// Draws the source editor's in-editor toolbar: groups of icon buttons and dropdowns that act on the editor without taking its focus.
import { headButton, renderElement, showMenu, type IconName } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/icons/index.js";

export interface SourceToolbarButton {
  label: string;
  glyph: IconName;
  run(): void;
  /** Drawn as an accent pill with its label at the toolbar's right end, for the one primary action such as Share. */
  primary?: boolean;
}

interface SourceToolbarOption { value: string; label: string; hint?: string }

/** A button that shows the current option and opens a menu of radio items to pick another. */
export interface SourceToolbarDropdown {
  label: string;
  glyph: IconName;
  options: readonly SourceToolbarOption[];
  current(): string;
  pick(value: string): void;
}

export type SourceToolbarItem = SourceToolbarButton | SourceToolbarDropdown;

function renderDropdown(item: SourceToolbarDropdown): HTMLElement {
  const button = renderElement("button", { type: "button", class: "source-editor-toolbar-dropdown", title: item.label, "aria-label": item.label, "aria-haspopup": "menu" });
  const caption = renderElement("span", { class: "source-editor-toolbar-dropdown-label" });
  const refresh = (): void => { caption.textContent = item.options.find((o) => o.value === item.current())?.label ?? ""; };
  button.innerHTML = renderIcon(item.glyph);
  button.append(caption);
  button.insertAdjacentHTML("beforeend", renderIcon("chevron-down"));
  refresh();
  button.addEventListener("click", () => {
    const current = item.current();
    showMenu(button, item.options.map((option) => ({
      label: option.label,
      ...(option.hint === undefined ? {} : { hint: option.hint }),
      radio: true,
      checked: option.value === current,
      onSelect: () => { item.pick(option.value); refresh(); },
    })));
  });
  return button;
}

function renderPrimary(item: SourceToolbarButton): HTMLElement {
  const button = renderElement("button", { type: "button", class: "source-editor-toolbar-primary", title: item.label, html: renderIcon(item.glyph) });
  button.append(renderElement("span", { text: item.label }));
  button.addEventListener("click", () => item.run());
  return button;
}

/** The toolbar for `groups`, each group set off from the next; a press keeps the editor's focus and selection, which the actions act on. */
export function renderSourceToolbar(groups: readonly (readonly SourceToolbarItem[])[]): HTMLElement {
  const bar = renderElement("div", { class: "source-editor-toolbar", role: "toolbar", "aria-label": "Editor actions" });
  for (const group of groups) {
    const end = group.some((item) => "primary" in item && item.primary);
    const section = renderElement("div", { class: `source-editor-toolbar-group${end ? " source-editor-toolbar-end" : ""}` });
    for (const item of group) {
      section.append("options" in item ? renderDropdown(item) : item.primary ? renderPrimary(item) : headButton("ls-icon-btn", item.label, item.glyph, item.run));
    }
    bar.append(section);
  }
  bar.addEventListener("mousedown", (event) => event.preventDefault());
  return bar;
}
