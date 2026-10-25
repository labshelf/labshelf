/**
 * Renders the paper detail tabs: Details, Annotations with their count (when the host sends annotations), Notes with a dot when
 * the paper has a note, and Related with its count. The bar stays in reach while a long tab scrolls.
 */
import { deriveRelatedGroups } from "../../../viewModel/index.js";
import type { DetailsTab } from "../../../store/index.js";
import type { PaneState, PaperView } from "../paneState.js";
import { renderTabBarHtml, type TabSpec } from "./tabBar.js";

export function renderPaperTabBarHtml(pane: PaneState, v: PaperView): string {
  const annotations = v.details?.annotations.length ?? v.stats?.annotations ?? 0;
  const related = deriveRelatedGroups(v.p, v.library, v.similar ?? []).total;
  const tabs: (TabSpec & { id: DetailsTab })[] = [
    { id: "details", label: "Details" },
    { id: "annotations", label: "Annotations", ...(annotations ? { badge: String(annotations) } : {}) },
    { id: "notes", label: "Notes", dot: !!pane.notes.text(v.p).trim() },
    { id: "related", label: "Related", ...(related ? { badge: String(related) } : {}) },
  ];
  return renderTabBarHtml(tabs, pane.tab);
}
