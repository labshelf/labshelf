// Builds the visible label above a subfolder group: muted parent path, semibold last folder and the paper count.
import { el } from "../../../../ui/dom/index.js";
import { escapeHtml } from "../../../../ui/index.js";
import { groupLabel } from "./groupPapers.js";

/** The label element for a group at `segments`; hidden from assistive tech because the rowgroup carries the name. */
export function buildGroupLabel(segments: readonly string[], count: number): HTMLElement {
  const { text, title } = groupLabel(segments);
  const last = segments[segments.length - 1]!;
  const parents = text.slice(0, text.length - last.length);
  return el("div", {
    class: "group-label", "aria-hidden": "true", title,
    html: `<span class="group-parents">${escapeHtml(parents)}</span><span class="group-last">${escapeHtml(last)}</span>` +
      `<span class="group-count">${count}</span>`,
  });
}
