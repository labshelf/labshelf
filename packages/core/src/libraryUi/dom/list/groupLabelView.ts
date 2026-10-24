// Builds the visible label above a subfolder group: muted parent path and semibold last folder.
import { el } from "../../../ui/dom/index.js";
import { escapeHtml, icon } from "../../../ui/index.js";
import { groupLabel } from "./groupPapers.js";

const SEP_HTML = `<span class="group-sep">${icon("chevron-right")}</span>`;

/** The path of the folder `up` levels above `folder`. */
const ancestor = (folder: string, up: number): string => folder.split("/").slice(0, folder.split("/").length - up).join("/");

/**
 * The label element for the group of `folder`, at `segments` below the scope. Each segment is a button carrying its
 * folder in data-folder; the label is hidden from assistive tech because the rowgroup carries the name, and the
 * sidebar and breadcrumb are the keyboard path to a folder.
 */
export function buildGroupLabel(folder: string, segments: readonly string[]): HTMLElement {
  const { shown, title } = groupLabel(segments);
  const last = segments.length - 1;
  const crumbs = shown.map((i, k) => {
    const gap = k > 0 && i > shown[k - 1]! + 1 ? `<span class="group-gap">…</span>${SEP_HTML}` : "";
    const btn = `<button type="button" tabindex="-1" class="${i === last ? "group-last" : "group-parent"}" ` +
      `data-folder="${escapeHtml(ancestor(folder, last - i))}" title="Open ${escapeHtml(segments[i]!)}">${escapeHtml(segments[i]!)}</button>`;
    return gap + btn;
  });
  return el("div", {
    class: "group-label", "aria-hidden": "true", title,
    html: crumbs.join(SEP_HTML),
  });
}
