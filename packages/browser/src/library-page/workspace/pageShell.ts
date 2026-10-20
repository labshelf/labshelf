// Frames the browser workspace with empty title and status bars.
import { PANE_LIMITS } from "@labshelf/core";
import { attachSash, el } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";

export interface PageShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  centre: HTMLElement;
}

/** Reuses the library frame's sidebar and sash styles (`.ls-library.has-sidebar`); the sidebar width and collapsed state persist in the prefs. */
export function createPageShell(host: HTMLElement, prefs: PagePrefs): PageShell {
  const saved = prefs.load();
  const root = el("div", { class: "ls-library has-sidebar ls-pane-frame" });
  const sidebar = el("aside", { class: "sidebar", "aria-label": "Library" });
  const sash = el("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  const centre = el("div", { class: "ls-workspace-centre" });
  sidebar.style.width = `${saved.sidebarWidth}px`;
  root.classList.toggle("sidebar-collapsed", saved.sidebarCollapsed);
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: "sidebar-collapsed", limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (sidebarWidth, sidebarCollapsed) => prefs.save({ sidebarWidth, sidebarCollapsed }),
  });
  root.append(sidebar, sash, centre);
  const titlebar = el("header", { class: "ls-workspace-titlebar", "aria-hidden": "true" });
  const statusbar = el("footer", { class: "ls-workspace-statusbar", "aria-hidden": "true" });
  host.append(titlebar, root, statusbar);
  return { root, sidebar, centre };
}
