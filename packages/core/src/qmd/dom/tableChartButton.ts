// The Chart button over a table, shared by the note editor and the LaTeX source editor: a pill fixed at the table's top right
// while the table is hovered or holds the selection, opening the menu of the charts the table can make. The editor that owns it
// says which table is active and what the menu holds; the button only places itself and opens the menu.
import { renderElement, showMenu, type MenuEntry } from "../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../ui/icons/index.js";
import type { TableChartKind } from "../chart/index.js";

/** The menu icon of each chart a table can make. */
export const CHART_ICONS: Readonly<Record<TableChartKind, IconName>> = {
  lines: "graph-line", scatter: "graph-scatter", area: "graph-line", bar: "graph", stacked: "graph", pie: "pie-chart", heatmap: "grid", surface: "package", scatter3d: "graph-scatter",
};

/** The box of the active table and how far from its right edge the button sits (to clear the table's own controls). */
export interface TableChartTarget { rect: DOMRect; inset: number }

export interface TableChartButtonHost {
  /** The editor's element; the button goes in its root, the document or a shadow root. */
  dom: HTMLElement;
  /** The active table, or null to hide the button. */
  target(): TableChartTarget | null;
  menu(): MenuEntry[];
  /** Runs when the pointer leaves the button for somewhere outside the editor. */
  leave(): void;
}

export interface TableChartButton {
  readonly element: HTMLButtonElement;
  /** Places the button on `target` (the host's active table when absent); hides it without one, except while its menu is open. */
  place(target?: TableChartTarget | null): void;
  destroy(): void;
}

const EDGE = 4;

export function mountTableChartButton(host: TableChartButtonHost): TableChartButton {
  const element = renderElement("button", {
    type: "button", class: "ls-table-chart", title: "Chart from table", "aria-haspopup": "menu", "aria-expanded": "false",
    html: `${renderIcon("graph-line")}<span>Chart</span>${renderIcon("chevron-down")}`,
  }) as HTMLButtonElement;
  element.hidden = true;
  const root = host.dom.getRootNode();
  const shadow = root instanceof ShadowRoot ? root : null;
  (shadow ?? document.body).append(element);
  const open = (): boolean => element.getAttribute("aria-expanded") === "true";

  const place = (target: TableChartTarget | null = host.target()): void => {
    if (open()) return;
    const visible = target !== null && target.rect.bottom > 0 && target.rect.top < window.innerHeight;
    element.hidden = !visible;
    if (!visible) return;
    element.style.top = `${Math.max(EDGE, target.rect.top + EDGE)}px`;
    element.style.left = `${target.rect.right - target.inset - element.offsetWidth - EDGE}px`;
  };
  const onScroll = (): void => place();
  // The editor keeps its focus and selection when the button is pressed.
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", () => {
    element.setAttribute("aria-expanded", "true");
    showMenu(element, host.menu(), { ...(shadow ? { root: shadow } : {}), onClose: () => { element.setAttribute("aria-expanded", "false"); place(); } });
  });
  element.addEventListener("mouseleave", (event) => { if (!host.dom.contains(event.relatedTarget as Node | null)) host.leave(); });
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onScroll);
  return {
    element,
    place,
    destroy() {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      element.remove();
    },
  };
}
