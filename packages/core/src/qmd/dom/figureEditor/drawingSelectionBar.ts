// The controls of a drawing's selection, shown in the toolbar: the stroke's colour, dash and width and the fill; what the selected
// object itself has (a regular polygon's sides, a polygon or curve closed or open, a line's arrowheads, a function for
// axes); Group and Ungroup when several objects are selected; Arrange (front, back, flips, alignment); Properties, which
// opens the panel with everything the object has; Duplicate and Delete.
import { renderElement, showMenu, wsButton, wsColour, wsNumber, wsSelect } from "../../../ui/dom/index.js";
import type { DrawingModel, DrawingStyle } from "../../../drawing/index.js";
import { addFunction, alignSelection, flipSelection, groupSelection, reorderSelection, ungroupSelection, type AlignEdge, type DrawingCanvas } from "../drawingEditor/index.js";
import { DRAWING_TITLES } from "./drawingInspector.js";

type Item = DrawingModel["items"][number];

/** The fill a new fill starts with, as a share of opacity. */
const FILL_OPACITY = 0.25;
const ALIGN: ReadonlyArray<{ edge: AlignEdge; label: string }> = [
  { edge: "left", label: "Align left" }, { edge: "center", label: "Align centres" }, { edge: "right", label: "Align right" },
  { edge: "top", label: "Align top" }, { edge: "middle", label: "Align middles" }, { edge: "bottom", label: "Align bottom" },
];
const ARROWS = [{ value: "none", label: "No arrow" }, { value: "end", label: "Arrow at end" }, { value: "both", label: "Arrows at both ends" }];

/** The selected item indexes. */
function selectedItems(canvas: DrawingCanvas): number[] {
  return [...canvas.state.selection].flatMap((key) => (/^i\d+$/.test(key) ? [Number(key.slice(1))] : []));
}

/** The style of the first selected item or node, or the style new items get. */
function selectedStyle(canvas: DrawingCanvas): DrawingStyle {
  const { model, selection } = canvas.state;
  const index = selectedItems(canvas)[0];
  const item = index === undefined ? undefined : model.items[index];
  const node = model.points.find((p) => p.shape !== undefined && selection.has(p.id));
  return (item && "style" in item ? item.style : node?.style) ?? canvas.state.style;
}

/** The selected item replaced by `next`, as one undo step. */
function editItem(canvas: DrawingCanvas, index: number, next: Item): void {
  const model = canvas.state.model;
  canvas.edit({ ...model, items: model.items.map((item, i) => (i === index ? next : item)) });
}

/** The stroke's colour, dash and width, and a fill that can be turned on and coloured. */
function styleControls(canvas: DrawingCanvas): HTMLElement[] {
  const style = selectedStyle(canvas);
  const set = (next: DrawingStyle): void => canvas.setStyle(next);
  const without = (key: keyof DrawingStyle): DrawingStyle => { const { [key]: _old, ...rest } = style; return rest; };
  const fill = wsButton({ label: "Fill", showLabel: true }, () => set(style.fill !== undefined ? (({ fill: _f, opacity: _o, ...rest }) => rest)(style) : { ...style, fill: style.color ?? "#1f77b4", opacity: FILL_OPACITY }), { pressed: style.fill !== undefined, variant: "tool" });
  return [
    wsColour(style.color ?? "#1f2328", (color) => set({ ...style, color }), "Stroke colour"),
    wsSelect([{ value: "solid", label: "———" }, { value: "dashed", label: "– – –" }, { value: "dotted", label: "· · · ·" }], style.dash ?? "solid", (d) => set(d === "solid" ? without("dash") : { ...style, dash: d as "dashed" | "dotted" }), "Line style"),
    wsSelect([{ value: "normal", label: "0.4 pt" }, { value: "thick", label: "0.8 pt" }], style.thick ? "thick" : "normal", (w) => set(w === "thick" ? { ...style, thick: true } : without("thick")), "Line width"),
    fill,
    ...(style.fill !== undefined ? [wsColour(style.fill, (colour) => set({ ...style, fill: colour }), "Fill colour")] : []),
  ];
}

/** What the single selected item has of its own. */
function itemControls(canvas: DrawingCanvas, index: number): HTMLElement[] {
  const item = canvas.state.model.items[index];
  const set = (next: Item): void => editItem(canvas, index, next);
  switch (item?.k) {
    case "ngon": return [renderElement("span", { class: "fe-selbar-label", text: "Sides" }), wsNumber(item.n, (n) => set({ ...item, n: Math.min(24, Math.max(3, Math.round(n))) }), { min: 3, max: 24, step: 1, label: "Sides" })];
    case "poly": case "curve": {
      const closed = wsButton({ label: "Closed", showLabel: true }, () => { const { ctrl: _c, ...rest } = item as Item & { ctrl?: unknown }; set({ ...rest, closed: !item.closed } as Item); }, { pressed: item.closed, variant: "tool" });
      if (item.k === "poly" || item.closed) { return [closed]; }
      return [closed, wsSelect(ARROWS, item.arrow ?? "none", (a) => { const { arrow: _a, ...rest } = item; set(a === "none" ? rest : { ...rest, arrow: a as "end" | "both" }); }, "Arrowheads")];
    }
    case "seg": return [wsSelect(ARROWS, item.arrow, (a) => set({ ...item, arrow: a as typeof item.arrow }), "Arrowheads")];
    case "arc": return item.close ? [] : [wsSelect(ARROWS, item.arrow ?? "none", (a) => { const { arrow: _a, ...rest } = item; set(a === "none" ? rest : { ...rest, arrow: a as "end" | "both" }); }, "Arrowheads")];
    case "axes": { const id = item.id; return [wsButton({ label: "Add function", showLabel: true }, () => canvas.run((s) => addFunction(s, s.model, id)))]; }
    default: return [];
  }
}

/** The selection's controls; `duplicate` and `remove` act as ⌘D and Delete do, `properties` shows or hides the panel with all of the object's properties. */
export function drawingSelectionBar(canvas: DrawingCanvas, duplicate: () => void, remove: () => void, properties: { open: boolean; toggle(): void }): HTMLElement {
  const { model, selection } = canvas.state;
  const items = selectedItems(canvas);
  const keys = [...selection];
  const groups = new Set(items.map((i) => model.items[i]?.g));
  const single = keys.length === 1 ? keys[0]! : null;
  const item = items.length === 1 && single ? model.items[items[0]!] : undefined;
  const name = item ? DRAWING_TITLES[item.k] : single ? (model.points.find((p) => p.id === single)?.shape ? "Node" : "Point") : groups.size === 1 && !groups.has(undefined) ? "Group" : `${keys.length} objects`;
  const grouping = [
    ...(items.length > 1 && (groups.size > 1 || groups.has(undefined)) ? [wsButton({ label: "Group", showLabel: true }, () => canvas.run(groupSelection))] : []),
    ...(items.some((i) => model.items[i]?.g) ? [wsButton({ label: "Ungroup", showLabel: true }, () => canvas.run(ungroupSelection))] : []),
  ];
  const arrange = wsButton({ label: "Arrange", showLabel: true }, (button) => showMenu(button, [
    { label: "Bring to front", onSelect: () => canvas.run((s) => reorderSelection(s, "front")) },
    { label: "Send to back", onSelect: () => canvas.run((s) => reorderSelection(s, "back")) },
    { label: "Flip horizontally", onSelect: () => canvas.run((s, ids) => flipSelection(s, "h", ids)) },
    { label: "Flip vertically", onSelect: () => canvas.run((s, ids) => flipSelection(s, "v", ids)) },
    ...(items.length > 1 ? ALIGN.map((a) => ({ label: a.label, onSelect: () => canvas.run((s) => alignSelection(s, a.edge)) })) : []),
  ]));
  return renderElement("div", { class: "fe-selbar", role: "toolbar", "aria-label": "Selection" },
    renderElement("span", { class: "fe-selbar-chip", text: name }),
    ...styleControls(canvas),
    ...(items.length === 1 && keys.length === 1 ? itemControls(canvas, items[0]!) : []),
    ...grouping,
    arrange,
    ...(keys.length === 1 ? [wsButton({ label: "Properties", showLabel: true }, properties.toggle, { pressed: properties.open, variant: "tool" })] : []),
    wsButton({ icon: "vs-copy", label: "Duplicate" }, duplicate),
    wsButton({ icon: "vs-trash", label: "Delete" }, remove));
}
