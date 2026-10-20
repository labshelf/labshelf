// Frames the browser workspace with a persistent Details pane.
import { PANE_LIMITS } from "@labshelf/core";
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
const DETAILS_LIMITS = { min: 260, max: 760, collapseAt: 180 };

/**
 * Reuses the library frame's sash styles (`.ls-library.has-sidebar`); pane widths and collapsed states persist in the prefs.
 */
export function createPageShell(host: HTMLElement, prefs: PagePrefs): PageShell {
  const saved = { ...prefs.load(), ...prefs.detailPane() };
  const root = el("div", { class: "ls-library has-sidebar ls-pane-frame" });
  const sidebar = el("aside", { class: "sidebar", "aria-label": "Library" });
  const sash = el("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  const centre = el("div", { class: "ls-workspace-centre" });
  const details = el("aside", { class: "ls-page-details ls-pane", "aria-label": "Details" });
  const detailSash = el("div", { class: "sash sash-detail", title: "Drag to resize" });
  // Until the user resizes Details, it opens as wide as the sidebar, within its own minimum.
  const detailDefault = Math.max(DETAILS_LIMITS.min, saved.sidebarWidth);
  sidebar.style.width = `${saved.sidebarWidth}px`;
  details.style.width = `${saved.detailWidth ?? detailDefault}px`;
  root.classList.toggle("sidebar-collapsed", saved.sidebarCollapsed);
  root.classList.toggle(DETAILS_COLLAPSED, saved.detailCollapsed);
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: "sidebar-collapsed", limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (sidebarWidth, sidebarCollapsed) => prefs.save({ sidebarWidth, sidebarCollapsed }),
  });
  attachSash(detailSash, {
    root, pane: details, collapsedClass: DETAILS_COLLAPSED, limits: DETAILS_LIMITS, defaultWidth: detailDefault,
    widthFromPointer: (x) => root.getBoundingClientRect().right - x,
    persist: (detailWidth, detailCollapsed) => prefs.saveDetailPane({ detailWidth, detailCollapsed }),
  });
  root.append(sidebar, sash, centre, detailSash, details);
  const titlebar = el("header", { class: "ls-workspace-titlebar", "aria-hidden": "true" });
  const statusbar = el("footer", { class: "ls-workspace-statusbar", "aria-hidden": "true" });
  host.append(titlebar, root, statusbar);
  const toggleDetails = (): void => {
    const collapsed = root.classList.toggle(DETAILS_COLLAPSED);
    prefs.saveDetailPane({ detailCollapsed: collapsed });
  };
  return { root, sidebar, centre, details, toggleDetails };
}
