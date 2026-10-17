// Builds the sidebar's collapsible headers: section headers and the group headings inside the Library section.
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";

/** Ids of the sections the sidebar can collapse. */
export type SectionId = "library" | "projects";

/** Ids of the groups the Library section can collapse; they share the collapsed set with the sections. */
export type GroupId = "library.folders" | "library.tags";

const chevronHtml = `<span class="tree-section-chevron">${icon("chevron-right")}</span>`;

/** `actions` holds icon buttons shown on hover; the whole row toggles the section. */
export function sectionRow(id: SectionId, label: string, open: boolean, actions = ""): HTMLElement {
  return el("div", {
    class: "tree-heading tree-section",
    role: "treeitem",
    "aria-expanded": String(open),
    "data-section": id,
    "data-key": `section:${id}`,
    html: `${chevronHtml}<span class="tree-section-label">${escapeHtml(label)}</span>` +
      (actions ? `<span class="tree-heading-actions">${actions}</span>` : ""),
  });
}

/** A heading that folds the rows under it; `actions` holds icon buttons shown on hover. */
export function groupRow(id: GroupId, label: string, open: boolean, actions = ""): HTMLElement {
  return el("div", {
    class: "tree-heading tree-group",
    role: "treeitem",
    "aria-expanded": String(open),
    "data-group": id,
    "data-key": `group:${id}`,
    html: `${chevronHtml}<span class="tree-section-label">${escapeHtml(label)}</span>` +
      (actions ? `<span class="tree-heading-actions">${actions}</span>` : ""),
  });
}
