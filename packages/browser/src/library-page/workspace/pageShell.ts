// Builds the library page's frame: the sidebar and the Details pane with their sashes around the centre slot that holds the editor area.
import { DEFAULT_PREFS, PANE_LIMITS } from "@labshelf/core";
import { attachSash, el } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";

export interface PageShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  centre: HTMLElement;
  /** The right pane outside the tabs. */
  details: HTMLElement;
  /** Shows the Details pane when collapsed and collapses it otherwise; the state persists in the prefs. */
  toggleDetails(): void;
}

const DETAILS_COLLAPSED = "details-collapsed";

/**
 * Reuses the library frame's sash styles (`.ls-library.has-sidebar`); pane widths and collapsed states persist in the prefs.
 * The Details collapsed class differs from core's `detail-collapsed`, which would also hide the detail panes inside tabs.
 */
export function createPageShell(host: HTMLElement, prefs: PagePrefs): PageShell {
  const saved = prefs.load();
  const root = el("div", { class: "ls-library has-sidebar" });
  const sidebar = el("aside", { class: "sidebar", "aria-label": "Library" });
  const sash = el("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  const centre = el("div", { class: "ls-workspace-centre" });
  // `ls-all-projects` scopes core's project-detail styles.
  const details = el("aside", { class: "ls-page-details ls-all-projects", "aria-label": "Details" });
  const detailSash = el("div", { class: "sash sash-detail", title: "Drag to resize" });
  sidebar.style.width = `${saved.sidebarWidth}px`;
  details.style.width = `${saved.detailWidth}px`;
  root.classList.toggle("sidebar-collapsed", saved.sidebarCollapsed);
  root.classList.toggle(DETAILS_COLLAPSED, saved.detailCollapsed);
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: "sidebar-collapsed", limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (sidebarWidth, sidebarCollapsed) => prefs.save({ sidebarWidth, sidebarCollapsed }),
  });
  attachSash(detailSash, {
    root, pane: details, collapsedClass: DETAILS_COLLAPSED, limits: PANE_LIMITS.detail, defaultWidth: DEFAULT_PREFS.detailWidth,
    widthFromPointer: (x) => root.getBoundingClientRect().right - x,
    persist: (detailWidth, detailCollapsed) => prefs.save({ detailWidth, detailCollapsed }),
  });
  root.append(sidebar, sash, centre, detailSash, details);
  host.append(root);
  const toggleDetails = (): void => {
    const collapsed = root.classList.toggle(DETAILS_COLLAPSED);
    prefs.save({ detailCollapsed: collapsed });
  };
  return { root, sidebar, centre, details, toggleDetails };
}
