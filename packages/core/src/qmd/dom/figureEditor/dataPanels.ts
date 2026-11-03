// The data mode's left panel: the data source (import a CSV, paste a table, the linked file or the inline table and its size)
// and the series list (visibility, colour, the columns each maps, a menu to move, duplicate or remove) with Add series.
import { renderElement, showMenu, wsButton, wsListRow, wsSection, type MenuEntry } from "../../../ui/dom/index.js";
import { columnLetter, EXPORT_THEME, type ChartTable, type ChartTrace, type FigureModel } from "../../chart/index.js";

/** A column's name for people: its header, else its letter. */
function columnName(table: ChartTable, letter: string | undefined): string {
  if (letter === undefined) return "—";
  const index = table.cols.findIndex((_, i) => columnLetter(i) === letter);
  return table.cols[index]?.name.trim() || letter;
}

/** The colour a series draws in: its own, else the palette's. */
export const seriesColour = (trace: ChartTrace, index: number): string => trace.color ?? EXPORT_THEME.palette[index % EXPORT_THEME.palette.length]!;

export const tableRows = (table: ChartTable): number => Math.max(0, ...table.cols.map((col) => col.values.length));

export interface DataPanelActions {
  importCsv?(): void;
  pasteTable(): void;
  refresh?(): void;
  select(index: number): void;
  toggle(index: number): void;
  add(): void;
  move(index: number, delta: -1 | 1): void;
  duplicate(index: number): void;
  remove(index: number): void;
}

/** The data source card: the file (or the inline table), its rows and columns, and Refresh for a linked file. */
function sourceCard(model: FigureModel, table: ChartTable, actions: DataPanelActions): HTMLElement {
  const name = model.src?.split("/").pop() ?? "Inline table";
  const size = `${tableRows(table)} rows · ${table.cols.length} columns`;
  const linked = model.src !== undefined ? renderElement("span", { class: "fe-linked", text: "Linked to the file" }) : null;
  const refresh = actions.refresh ? wsButton({ icon: "reload", label: "Refresh", showLabel: true }, () => actions.refresh!(), { extra: "fe-card-action" }) : null;
  return renderElement("div", { class: "fe-card" }, renderElement("div", { class: "fe-card-text" }, renderElement("strong", { text: name }), renderElement("span", { class: "fe-card-sub", text: size }), linked), refresh);
}

/** The Data section: Import CSV and Paste table, then the source card. */
function dataSection(model: FigureModel, table: ChartTable, actions: DataPanelActions): HTMLElement {
  const section = wsSection("Data", { collapsible: true });
  const importCsv = actions.importCsv ? wsButton({ icon: "add", label: "Import CSV", showLabel: true }, () => actions.importCsv!(), { variant: "outline", extra: "fe-primary-outline" }) : null;
  const paste = wsButton({ icon: "clippy", label: "Paste table", showLabel: true }, () => actions.pasteTable(), { variant: "outline" });
  section.body.append(renderElement("div", { class: "fe-button-row" }, importCsv, paste), sourceCard(model, table, actions));
  return section.element;
}

/** The menu of one series. */
function seriesMenu(index: number, count: number, actions: DataPanelActions): MenuEntry[] {
  return [
    { label: "Move up", icon: "arrow-up", disabled: index === 0, onSelect: () => actions.move(index, -1) },
    { label: "Move down", icon: "chevron-down", disabled: index === count - 1, onSelect: () => actions.move(index, 1) },
    { label: "Duplicate", icon: "vs-copy", onSelect: () => actions.duplicate(index) },
    { label: "Remove", icon: "vs-trash", onSelect: () => actions.remove(index) },
  ];
}

/** The Series section: one row per trace and Add series. */
function seriesSection(model: FigureModel, table: ChartTable, selected: number | null, actions: DataPanelActions): HTMLElement {
  const section = wsSection("Series", { actions: [wsButton({ icon: "add", label: "Add series" }, () => actions.add())] });
  const list = renderElement("div", { class: "ws-list", role: "listbox", "aria-label": "Series" });
  model.traces.forEach((trace, i) => {
    const menu = wsButton({ icon: "ellipsis", label: "Series actions" }, (button) => showMenu(button, seriesMenu(i, model.traces.length, actions)));
    const label = trace.name?.trim() || columnName(table, trace.y) || `Series ${i + 1}`;
    const sub = trace.type === "pie" ? columnName(table, trace.y) : `${columnName(table, trace.x)} → ${columnName(table, trace.y)}`;
    list.append(wsListRow({ label, sub, swatch: seriesColour(trace, i), visible: trace.hidden !== true, selected: selected === i, trailing: [menu] }, { select: () => actions.select(i), toggle: () => actions.toggle(i) }));
  });
  section.body.append(list, wsButton({ icon: "add", label: "Add series", showLabel: true }, () => actions.add(), { variant: "outline", extra: "ws-add" }));
  return section.element;
}

/** Fills the left panel. */
export function renderDataPanels(left: HTMLElement, model: FigureModel, table: ChartTable, selected: number | null, actions: DataPanelActions): void {
  left.replaceChildren(dataSection(model, table, actions), seriesSection(model, table, selected, actions), renderElement("p", { class: "fe-left-note", text: "The original data is kept as imported." }));
}
