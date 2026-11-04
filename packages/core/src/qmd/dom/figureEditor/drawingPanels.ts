// The drawing mode's left panel: the tools (selection, points and lines, shapes, diagram nodes and angle marks, functions and
// labels), each with its key and the hint the status bar shows, and the list of the drawing's objects, each selecting its
// object on the canvas.
import { renderElement, renderIcon, wsListRow, wsSection, type IconName } from "../../../ui/dom/index.js";
import type { DrawingModel } from "../../../drawing/index.js";
import type { Tool } from "../drawingEditor/index.js";

export const TOOLS: readonly { tool: Tool; label: string; icon: IconName; key: string; hint: string }[] = [
  { tool: "select", label: "Select", icon: "pointer", key: "V", hint: "Drag to move · Box handles stretch, turn and skew · Double-click a curve to add a point, Delete removes one" },
  { tool: "point", label: "Point", icon: "circle-filled", key: "P", hint: "Click to place a point" },
  { tool: "line", label: "Segment", icon: "segment", key: "L", hint: "Drag from one point to another" },
  { tool: "arrow", label: "Arrow", icon: "arrow-diagonal", key: "A", hint: "Drag from one point or node to another" },
  { tool: "polygon", label: "Polygon", icon: "draw-polygon", key: "G", hint: "Click each corner · Click the first one or press Enter to close" },
  { tool: "curve", label: "Curve", icon: "draw-curve", key: "B", hint: "Click points the curve passes through · Double-click or Enter to end · Click the first to close" },
  { tool: "circle", label: "Circle", icon: "circle-large", key: "C", hint: "Drag from the centre outwards" },
  { tool: "ellipse", label: "Ellipse", icon: "draw-ellipse", key: "E", hint: "Drag from the centre outwards · Shift for a circle" },
  { tool: "rect", label: "Rectangle", icon: "primitive-square", key: "R", hint: "Drag from one corner to the other" },
  { tool: "ngon", label: "Regular polygon", icon: "draw-ngon", key: "N", hint: "Drag from the centre to a corner · Press 3 to 9 for the number of sides" },
  { tool: "arc", label: "Arc", icon: "draw-arc", key: "K", hint: "Drag from the centre to where the arc starts · Drag its ends to resize" },
  { tool: "angle", label: "Angle", icon: "draw-angle", key: "Q", hint: "Click a point on one side, the vertex, then a point on the other side" },
  { tool: "node", label: "Node", icon: "draw-node", key: "O", hint: "Click to place a node and type its label · Join nodes with Arrow" },
  { tool: "function", label: "Function", icon: "sine", key: "F", hint: "Click inside axes to plot a function" },
  { tool: "label", label: "Label", icon: "text-size", key: "T", hint: "Click to place a label" },
];

type Item = DrawingModel["items"][number];

/** An object of the list: its selection key, its name, icon and colour. */
export interface DrawingObject { key: string; name: string; icon: IconName; colour?: string }

const GREEK: Readonly<Record<string, string>> = { alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", phi: "φ", omega: "ω" };

/** A label's TeX as plain text for the list: Greek commands as letters, braces and dollars dropped. */
const plainTex = (tex: string): string => tex.replace(/\\([a-zA-Z]+)/g, (_whole, name: string) => GREEK[name] ?? name).replace(/[{}$]/g, "").trim();

const pointName = (model: DrawingModel, id: string): string => plainTex(model.points.find((p) => p.id === id)?.label ?? "") || id;

/** The name and icon of one item. */
function describe(model: DrawingModel, item: Item): { name: string; icon: IconName } {
  switch (item.k) {
    case "axes": return { name: "Cartesian axes", icon: "axes" };
    case "fn": return { name: `f(x) = ${item.expr}`, icon: "sine" };
    case "seg": return { name: `${item.arrow === "none" ? "Segment" : "Arrow"} ${pointName(model, item.a)}${pointName(model, item.b)}`, icon: item.arrow === "none" ? "segment" : "arrow-diagonal" };
    case "circle": return { name: `Circle at ${pointName(model, item.c)}`, icon: "circle-large" };
    case "rect": return { name: "Rectangle", icon: "primitive-square" };
    case "poly": return { name: item.closed ? "Polygon" : "Polyline", icon: "draw-polygon" };
    case "curve": return { name: item.closed ? "Closed curve" : "Curve", icon: "draw-curve" };
    case "ngon": return { name: item.star !== undefined ? `Star, ${item.n} points` : `Regular polygon, ${item.n} sides`, icon: "draw-ngon" };
    case "ellipse": return { name: `Ellipse at ${pointName(model, item.c)}`, icon: "draw-ellipse" };
    case "arc": return { name: item.close === "sector" ? "Sector" : item.close === "chord" ? "Circular segment" : "Arc", icon: "draw-arc" };
    case "angle": return { name: `Angle ${pointName(model, item.a)}${pointName(model, item.o)}${pointName(model, item.b)}`, icon: "draw-angle" };
    case "text": return { name: `Label ${plainTex(item.tex)}`, icon: "text-size" };
  }
}

/** The drawing's objects in list order: items first, then the points that carry a dot or a label. */
export function drawingObjects(model: DrawingModel): DrawingObject[] {
  const items = model.items.map((item, i): DrawingObject => {
    const style = "style" in item ? item.style : undefined;
    return { key: `i${i}`, ...describe(model, item), ...(style?.color ? { colour: style.color } : {}) };
  });
  const points = model.points.filter((p) => p.dot || p.label || p.shape).map((p): DrawingObject => ({ key: p.id, name: `${p.shape ? "Node" : "Point"} ${pointName(model, p.id)}`, icon: p.shape ? "draw-node" : "circle-small-filled" }));
  return [...items, ...points];
}

export interface DrawingPanelActions { tool(tool: Tool): void; select(key: string): void }

/** Fills the left panel. */
export function renderDrawingPanels(left: HTMLElement, model: DrawingModel, tool: Tool, selection: ReadonlySet<string>, a: DrawingPanelActions): void {
  const tools = wsSection("Tools");
  const grid = renderElement("div", { class: "fe-tool-grid" }, ...TOOLS.map((t) => {
    const button = renderElement("button", { type: "button", class: "ws-btn ws-btn-tool fe-tool", "aria-pressed": String(t.tool === tool), title: `${t.label} (${t.key})`, html: renderIcon(t.icon) }, renderElement("span", { text: t.label }));
    if (t.tool === "select") button.append(renderElement("kbd", { text: t.key }));
    button.addEventListener("click", () => a.tool(t.tool));
    return button;
  }));
  tools.body.append(grid);
  const objects = wsSection("Objects");
  const list = renderElement("div", { class: "ws-list", role: "listbox", "aria-label": "Objects" }, ...drawingObjects(model).map((o) => wsListRow({ label: o.name, icon: o.icon, ...(o.colour ? { swatch: o.colour } : {}), selected: selection.has(o.key) }, { select: () => a.select(o.key) })));
  objects.body.append(model.items.length + model.points.length === 0 ? renderElement("p", { class: "fe-hint", text: "Pick a tool and draw on the canvas." }) : list);
  left.replaceChildren(tools.element, objects.element, renderElement("p", { class: "fe-left-note", text: "Double-click to edit a label or an expression." }));
}
