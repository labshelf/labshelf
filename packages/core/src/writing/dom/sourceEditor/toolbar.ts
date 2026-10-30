// Draws the source editor's in-editor toolbar: groups of icon buttons that act on the editor without taking its focus.
import { headButton, renderElement, type IconName } from "../../../ui/dom/index.js";

export interface SourceToolbarButton {
  label: string;
  glyph: IconName;
  run(): void;
}

/** The toolbar for `groups`, each group set off from the next; a press keeps the editor's focus and selection, which the actions act on. */
export function renderSourceToolbar(groups: readonly (readonly SourceToolbarButton[])[]): HTMLElement {
  const bar = renderElement("div", { class: "source-editor-toolbar", role: "toolbar", "aria-label": "Editor actions" });
  for (const group of groups) {
    const section = renderElement("div", { class: "source-editor-toolbar-group" });
    for (const { label, glyph, run } of group) { section.append(headButton("ls-icon-btn", label, glyph, run)); }
    bar.append(section);
  }
  bar.addEventListener("mousedown", (event) => event.preventDefault());
  return bar;
}
