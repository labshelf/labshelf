// Frames the browser workspace with a persistent right pane.
import { PANE_LIMITS } from "@labshelf/core";
import { attachSash, renderElement } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";

export interface PageShell {
  root: HTMLElement;
  sidebar: HTMLElement;
  centre: HTMLElement;
  details: HTMLElement;
  chat: HTMLElement;
  togglePane(pane: "details" | "chat"): void;
}

const DETAILS_COLLAPSED = "details-collapsed";
const DETAILS_LIMITS = { min: 260, max: 760, collapseAt: 180 };

export function createPageShell(host: HTMLElement, prefs: PagePrefs): PageShell {
  const saved = { ...prefs.load(), ...prefs.detailPane() };
  const root = renderElement("div", { class: "ls-library has-sidebar ls-pane-frame" });
  const sidebar = renderElement("aside", { class: "sidebar", "aria-label": "Library" });
  const sash = renderElement("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  const centre = renderElement("div", { class: "ls-workspace-centre" });
  const right = renderElement("aside", { class: "ls-page-details ls-pane", "aria-label": "Details" });
  const details = renderElement("div", { class: "ls-workspace-fill" });
  const chat = renderElement("div", { class: "ls-workspace-fill" });
  right.append(details, chat);
  const show = (pane: "details" | "chat"): void => {
    details.hidden = pane !== "details";
    chat.hidden = pane !== "chat";
    root.dataset["rightPane"] = pane;
    right.setAttribute("aria-label", pane === "chat" ? "Research chat" : "Details");
  };
  show(saved.rightPane);
  const detailSash = renderElement("div", { class: "sash sash-detail", title: "Drag to resize" });
  // INVARIANT: An undragged right pane follows the sidebar width within its own minimum.
  const detailDefault = Math.max(DETAILS_LIMITS.min, saved.sidebarWidth);
  sidebar.style.width = `${saved.sidebarWidth}px`;
  right.style.width = `${saved.detailWidth ?? detailDefault}px`;
  root.classList.toggle("sidebar-collapsed", saved.sidebarCollapsed);
  root.classList.toggle(DETAILS_COLLAPSED, saved.detailCollapsed);
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: "sidebar-collapsed", limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    persist: (sidebarWidth, sidebarCollapsed) => prefs.save({ sidebarWidth, sidebarCollapsed }),
  });
  attachSash(detailSash, {
    root, pane: right, collapsedClass: DETAILS_COLLAPSED, limits: DETAILS_LIMITS, defaultWidth: detailDefault,
    widthFromPointer: (x) => root.getBoundingClientRect().right - x,
    persist: (detailWidth, detailCollapsed) => prefs.saveDetailPane({ detailWidth, detailCollapsed }),
  });
  root.append(sidebar, sash, centre, detailSash, right);
  const titlebar = renderElement("header", { class: "ls-workspace-titlebar", "aria-hidden": "true" });
  const statusbar = renderElement("footer", { class: "ls-workspace-statusbar", "aria-hidden": "true" });
  host.append(titlebar, root, statusbar);
  const togglePane = (pane: "details" | "chat"): void => {
    const collapsed = root.dataset["rightPane"] === pane && !root.classList.contains(DETAILS_COLLAPSED);
    show(pane);
    root.classList.toggle(DETAILS_COLLAPSED, collapsed);
    prefs.saveDetailPane({ rightPane: pane, detailCollapsed: collapsed });
  };
  return { root, sidebar, centre, details, chat, togglePane };
}
