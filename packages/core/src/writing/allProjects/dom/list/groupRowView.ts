// Builds a folder's header row in the project treegrid: a chevron and the folder path, toggling the folder's projects on click.
import { el } from "../../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import type { ProjectGroup } from "../../viewModel/index.js";

/** The project row's cell count, which the header's single cell spans. */
const COLUMNS = 7;

const groupAriaLabel = (g: ProjectGroup): string =>
  `${g.segments.join(" / ")}, ${g.rows.length} ${g.rows.length === 1 ? "project" : "projects"}`;

export function buildGroupRow(group: ProjectGroup, collapsed: boolean, onToggle: (key: string) => void): HTMLElement {
  const path = group.segments.map((s) => `<span class="group-segment">${escapeHtml(s)}</span>`).join(`<span class="group-sep" aria-hidden="true">/</span>`);
  const chevron = `<span class="group-chevron" aria-hidden="true">${icon(collapsed ? "chevron-right" : "chevron-down")}</span>`;
  const node = el("div", {
    class: "group-label", role: "row", tabindex: "-1", "aria-label": groupAriaLabel(group), title: group.segments.join(" / "),
    html: `<div class="group-cell" role="gridcell" aria-colspan="${COLUMNS}">${chevron}${path}</div>`,
  });
  node.addEventListener("click", () => onToggle(group.key));
  return node;
}
