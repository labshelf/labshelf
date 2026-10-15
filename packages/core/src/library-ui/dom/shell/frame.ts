/**
 * Builds the library UI frame once: an optional sidebar slot, the list pane (header, filter bar, list) and the
 * detail pane, with a sash beside each side pane. Navigation never rebuilds it; each view repaints its own slice.
 */
import { el } from "../../../ui/dom/index.js";
import { DEFAULT_PREFS, PANE_LIMITS, type PrefsPort } from "../../state/index.js";
import { attachSash } from "./sash.js";

type PaneName = "sidebar" | "detail";

interface FrameSlots {
  root: HTMLElement;
  /** Present when the host asked for a sidebar; the host fills it. */
  sidebar: HTMLElement | null;
  header: HTMLElement;
  filterBar: HTMLElement;
  list: HTMLElement;
  detail: HTMLElement;
  dispose(): void;
}

const COLLAPSED_CLASS: Record<PaneName, string> = { sidebar: "sidebar-collapsed", detail: "detail-collapsed" };

function sidePane(root: HTMLElement, pane: HTMLElement, which: PaneName, prefs: PrefsPort): { sash: HTMLElement; dispose: () => void } {
  const sash = el("div", { class: `sash sash-${which}`, title: "Drag to resize" });
  const dispose = attachSash(sash, {
    root, pane, collapsedClass: COLLAPSED_CLASS[which], limits: PANE_LIMITS[which],
    widthFromPointer: which === "sidebar" ? (x) => x - root.getBoundingClientRect().left : (x) => root.getBoundingClientRect().right - x,
    persist: (width, collapsed) => prefs.save(which === "sidebar" ? { sidebarWidth: width, sidebarCollapsed: collapsed } : { detailWidth: width, detailCollapsed: collapsed }),
    ...(which === "detail" ? { defaultWidth: DEFAULT_PREFS.detailWidth } : {}),
  });
  return { sash, dispose };
}

/** Builds the frame inside `host` and applies the saved pane widths and collapsed states. */
export function buildFrame(host: HTMLElement, prefs: PrefsPort, withSidebar: boolean): FrameSlots {
  const saved = prefs.load();
  const root = el("div", { class: ["ls-library", ...(withSidebar ? ["has-sidebar"] : [])].join(" ") });
  const header = el("div", { class: "list-header" });
  const filterBar = el("div", { class: "filter-bar" });
  const list = el("div", { class: "list-body" });
  const detail = el("aside", { class: "detail-pane", "aria-label": "Paper details" });
  detail.style.width = `${saved.detailWidth}px`;
  root.classList.toggle(COLLAPSED_CLASS.detail, saved.detailCollapsed);
  const detailSide = sidePane(root, detail, "detail", prefs);
  const listPane = el("section", { class: "list-pane" }, header, filterBar, list);
  let sidebar: HTMLElement | null = null;
  const disposers = [detailSide.dispose];
  if (withSidebar) {
    sidebar = el("aside", { class: "sidebar", "aria-label": "Library" });
    sidebar.style.width = `${saved.sidebarWidth}px`;
    root.classList.toggle(COLLAPSED_CLASS.sidebar, saved.sidebarCollapsed);
    const sidebarSide = sidePane(root, sidebar, "sidebar", prefs);
    disposers.push(sidebarSide.dispose);
    root.append(sidebar, sidebarSide.sash);
  }
  root.append(listPane, detailSide.sash, detail);
  host.append(root);
  return { root, sidebar, header, filterBar, list, detail, dispose: () => disposers.forEach((d) => d()) };
}

/** Shows a side pane if it is collapsed, and saves that. */
export function showPane(root: HTMLElement, prefs: PrefsPort, which: PaneName): void {
  if (!root.classList.contains(COLLAPSED_CLASS[which])) return;
  root.classList.remove(COLLAPSED_CLASS[which]);
  prefs.save(which === "sidebar" ? { sidebarCollapsed: false } : { detailCollapsed: false });
}

/** Toggles a side pane and saves the new state; returns whether it is now collapsed. */
export function togglePane(root: HTMLElement, prefs: PrefsPort, which: PaneName): boolean {
  const collapsed = root.classList.toggle(COLLAPSED_CLASS[which]);
  prefs.save(which === "sidebar" ? { sidebarCollapsed: collapsed } : { detailCollapsed: collapsed });
  return collapsed;
}
