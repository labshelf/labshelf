// The /open/ page shell, as the extension's library page draws it: the sidebar, its sash and the centre for the tabs; widths live in memory only.
import { PANE_LIMITS } from "@labshelf/core";
import { attachSash, renderElement } from "@labshelf/core/dom";

export interface OpenShell { root: HTMLElement; sidebar: HTMLElement; centre: HTMLElement }

const SIDEBAR_WIDTH = 260;

export function createOpenShell(host: HTMLElement): OpenShell {
  const root = renderElement("div", { class: "ls-library has-sidebar ls-pane-frame" });
  const sidebar = renderElement("aside", { class: "sidebar", "aria-label": "Library" });
  const sash = renderElement("div", { class: "sash sash-sidebar", title: "Drag to resize" });
  const centre = renderElement("div", { class: "ls-workspace-centre" });
  sidebar.style.width = `${SIDEBAR_WIDTH}px`;
  attachSash(sash, {
    root, pane: sidebar, collapsedClass: "sidebar-collapsed", limits: PANE_LIMITS.sidebar,
    widthFromPointer: (x) => x - root.getBoundingClientRect().left,
    // The page keeps nothing: the width lasts until the page closes.
    persist: () => undefined,
  });
  root.append(sidebar, sash, centre);
  host.append(root);
  return { root, sidebar, centre };
}
