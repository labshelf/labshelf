// The chart picker: the 12 chart types of the chart editor as labelled tiles (Mathcha's order) that arrow keys move between,
// and the empty chart a tile makes.
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon, type IconName } from "../../../ui/icons/index.js";
import { emptyChart, type ChartKind, type ChartModel, type ChartTrace } from "../../chart/index.js";

export interface ChartTile { id: string; label: string; icon: IconName; kind: ChartKind; trace?: string }

const TILES: readonly ChartTile[] = [
  { id: "fn2d", label: "Function Plot", icon: "function-square", kind: "fn2d" },
  { id: "fn3d", label: "Function 3d Plot", icon: "box", kind: "fn3d" },
  { id: "scatter", label: "Scatter", icon: "chart-scatter", kind: "data", trace: "scatter" },
  { id: "line", label: "Line", icon: "chart-line", kind: "data", trace: "scatter" },
  { id: "area", label: "Area", icon: "chart-area", kind: "data", trace: "scatter" },
  { id: "contour", label: "Contour", icon: "target", kind: "data", trace: "contour" },
  { id: "heatmap", label: "Heatmap", icon: "grid", kind: "data", trace: "heatmap" },
  { id: "pie", label: "Pie", icon: "chart-pie", kind: "data", trace: "pie" },
  { id: "bar", label: "Bar", icon: "chart-bar", kind: "data", trace: "bar" },
  { id: "surface", label: "Surface 3d", icon: "layers", kind: "data", trace: "surface" },
  { id: "scatter3d", label: "Scatter 3d", icon: "chart-scatter", kind: "data", trace: "scatter3d" },
  { id: "mesh3d", label: "Mesh 3d", icon: "box", kind: "data", trace: "mesh3d" },
];

/** Tiles per row of the picker's grid. */
const COLUMNS = 4;

/** The 12 tiles in the order the picker shows them. */
export function chartTiles(): readonly ChartTile[] {
  return TILES;
}

/** A new chart id: 8 hexadecimal characters. */
function newChartId(): string {
  const bytes = new Uint8Array(4);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The first trace a data tile starts with. */
function firstTrace(tile: ChartTile): ChartTrace | null {
  if (tile.kind !== "data" || tile.trace === undefined) return null;
  const type = tile.trace as ChartTrace["type"];
  switch (tile.id) {
    case "line": return { type, x: "A", y: "B", mode: "lines" };
    case "area": return { type, x: "A", y: "B", mode: "lines", fill: "tozeroy" };
    case "scatter": return { type, x: "A", y: "B", mode: "markers" };
    case "bar":
    case "pie":
    case "scatter3d": return { type, x: "A", y: "B" };
    default: return { type };
  }
}

/** The new empty chart of `tile`'s kind with the tile's first trace type, under a fresh id. */
export function chartOfTile(tile: ChartTile): ChartModel {
  const model = emptyChart(tile.kind, newChartId());
  const trace = firstTrace(tile);
  if (trace) model.traces = [trace];
  return model;
}

/** The picker: a grid of labelled tiles; click or Enter picks, the arrow keys move between tiles. */
export function renderChartPicker(onPick: (tile: ChartTile) => void): HTMLElement {
  const buttons = TILES.map((tile, index) => {
    const button = renderElement("button", { class: "qmd-chart-tile", type: "button", "aria-label": tile.label, tabindex: index === 0 ? "0" : "-1" },
      renderElement("span", { class: "qmd-chart-tile-icon", html: renderIcon(tile.icon) }),
      renderElement("span", { class: "qmd-chart-tile-label", text: tile.label }),
    );
    button.addEventListener("click", () => onPick(tile));
    button.addEventListener("focus", () => { for (const other of buttons) other.tabIndex = other === button ? 0 : -1; });
    return button;
  });
  const picker = renderElement("div", { class: "qmd-chart-picker", role: "group", "aria-label": "Chart type" }, ...buttons);
  picker.addEventListener("keydown", (event) => {
    const index = buttons.findIndex((button) => button === document.activeElement);
    if (index < 0) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onPick(TILES[index]!);
      return;
    }
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? COLUMNS : event.key === "ArrowUp" ? -COLUMNS : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = index + step;
    if (next >= 0 && next < buttons.length) buttons[next]!.focus();
  });
  return picker;
}
