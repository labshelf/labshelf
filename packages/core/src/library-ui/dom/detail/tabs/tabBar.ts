/**
 * Renders the detail tabs: Details, Annotations with their count (when the host sends annotations), Notes with a dot when
 * the paper has a note, and Related with its count. The bar stays in reach while a long tab scrolls.
 */
import { relatedGroups } from "../../../derive/index.js";
import type { DetailTab } from "../../../state/index.js";
import type { PaneState, PaperView } from "../paneState.js";

const TAB_LABEL: Record<DetailTab, string> = { details: "Details", annotations: "Annotations", notes: "Notes", related: "Related" };

export function tabBarHtml(pane: PaneState, v: PaperView): string {
  const annotations = v.details?.annotations.length ?? v.stats?.annotations ?? 0;
  const related = relatedGroups(v.p, v.library, v.similar ?? []).total;
  const badge: Record<DetailTab, string> = {
    details: "",
    annotations: annotations ? `<span class="tab-badge">${annotations}</span>` : "",
    notes: pane.notes.text(v.p).trim() ? `<span class="tab-dot" aria-label="has a note"></span>` : "",
    related: related ? `<span class="tab-badge">${related}</span>` : "",
  };
  const tabs = Object.keys(TAB_LABEL) as DetailTab[];
  const active = pane.tab;
  return `<div class="detail-tabs" role="tablist">${tabs.map((t) =>
    `<button class="detail-tab${active === t ? " active" : ""}" type="button" role="tab" aria-selected="${active === t}" data-action="tab" data-tab="${t}">${TAB_LABEL[t]}${badge[t]}</button>`,
  ).join("")}</div>`;
}
