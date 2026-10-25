/**
 * Builds the library UI frame once: an optional sidebar slot with its sash, and the list pane (header, list, and the
 * citation map that takes their place while it is open). Navigation never rebuilds it; each view repaints its own slice.
 */
import { renderElement } from "../../../ui/dom/index.js";
import { PANE_LIMITS, type PanePrefsPort } from "../../store/index.js";
import { attachSash } from "./sash.js";

export interface FrameSlots {
  root: HTMLElement;
  /** Present when the host asked for a sidebar; the host fills it. */
  sidebar: HTMLElement | null;
  header: HTMLElement;
  list: HTMLElement;
  /** Present when the host asked for a citation map. */
  citationMap: HTMLElement | null;
}

const SIDEBAR_COLLAPSED_CLASS = "sidebar-collapsed";

function sidebarSash(root: HTMLElement, sidebar: HTMLElement, prefs: PanePrefsPort): HTMLElement {
  const sash = renderElement("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: SIDEBAR_COLLAPSED_CLASS, limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (width, collapsed) => prefs.save({ sidebarWidth: width, sidebarCollapsed: collapsed }),
  });
  return sash;
}

export interface FrameOptions {
  withSidebar: boolean;
  withCitationMap: boolean;
}

/** Builds the frame inside `host` and applies the saved sidebar width and collapsed state. */
export function buildFrame(host: HTMLElement, prefs: PanePrefsPort, options: FrameOptions): FrameSlots {
  const { withSidebar, withCitationMap } = options;
  const saved = prefs.load();
  const root = renderElement("div", { class: ["ls-library", ...(withSidebar ? ["has-sidebar"] : [])].join(" ") });
  const header = renderElement("div", { class: "list-header" });
  const list = renderElement("div", { class: "list-body" });
  const citationMap = withCitationMap ? renderElement("section", { class: "citation-map", "aria-label": "Citation map", hidden: true }) : null;
  const listPane = renderElement("section", { class: "list-pane" }, header, list, ...(citationMap ? [citationMap] : []));
  let sidebar: HTMLElement | null = null;
  if (withSidebar) {
    sidebar = renderElement("aside", { class: "sidebar", "aria-label": "Library" });
    sidebar.style.width = `${saved.sidebarWidth}px`;
    root.classList.toggle(SIDEBAR_COLLAPSED_CLASS, saved.sidebarCollapsed);
    root.append(sidebar, sidebarSash(root, sidebar, prefs));
  }
  root.append(listPane);
  host.append(root);
  return { root, sidebar, header, list, citationMap };
}

/** Toggles the sidebar and saves the new state; returns whether it is now collapsed. */
export function updateSidebarOpen(root: HTMLElement, prefs: PanePrefsPort): boolean {
  const collapsed = root.classList.toggle(SIDEBAR_COLLAPSED_CLASS);
  prefs.save({ sidebarCollapsed: collapsed });
  return collapsed;
}
