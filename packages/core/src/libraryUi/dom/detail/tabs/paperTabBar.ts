/**
 * Renders the paper detail tabs: Details, Annotations with their count (when the host sends annotations), Notes with a dot when
 * the paper has a note, and Related with its count. The bar stays in reach while a long tab scrolls.
 */
import { relatedGroups } from "../../../derive/index.js";
import type { DetailTab } from "../../../state/index.js";
import type { PaneState, PaperView } from "../paneState.js";
import { tabBarHtml, type TabSpec } from "./tabBar.js";

export function paperTabBarHtml(pane: PaneState, v: PaperView): string {
  const annotations = v.details?.annotations.length ?? v.stats?.annotations ?? 0;
  const related = relatedGroups(v.p, v.library, v.similar ?? []).total;
  const tabs: (TabSpec & { id: DetailTab })[] = [
    { id: "details", label: "Details" },
    { id: "annotations", label: "Annotations", ...(annotations ? { badge: String(annotations) } : {}) },
    { id: "notes", label: "Notes", dot: !!pane.notes.text(v.p).trim() },
    { id: "related", label: "Related", ...(related ? { badge: String(related) } : {}) },
  ];
  return tabBarHtml(tabs, pane.tab);
}
