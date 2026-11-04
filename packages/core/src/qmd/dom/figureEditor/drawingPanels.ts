// The drawing mode's left panel: a strip of tools (selection, points, lines and arrows, polygon, pen, pencil, angle marks,
// nodes, text), each with its key and the hint the status bar shows; the ready-made shapes by section, drawn from the shapes
// themselves, each inserting one; and the list of the drawing's objects, each selecting its object on the canvas.
import { renderElement, renderIcon, wsListRow, wsSection, type IconName } from "../../../ui/dom/index.js";
import { formatDrawingSvg, layoutDrawing, type DrawingModel } from "../../../drawing/index.js";
import { SHAPE_SECTIONS, SHAPES, templateModel, type ShapeTemplate, type Tool } from "../drawingEditor/index.js";

export const TOOLS: readonly { tool: Tool; label: string; icon: IconName; key: string; hint: string }[] = [
  { tool: "select", label: "Select", icon: "pointer", key: "V", hint: "Click or drag around objects to select · Box handles stretch, turn and skew · Double-click a curve to add a point, Delete removes one" },
  { tool: "point", label: "Point", icon: "circle-filled", key: "P", hint: "Click to place a point" },
  { tool: "line", label: "Segment", icon: "segment", key: "L", hint: "Drag from one point to another" },
  { tool: "arrow", label: "Arrow", icon: "arrow-diagonal", key: "A", hint: "Drag from one point or node to another" },
  { tool: "polygon", label: "Polygon", icon: "draw-polygon", key: "G", hint: "Click each corner · Click the first one or press Enter to close · Backspace undoes a corner" },
  { tool: "curve", label: "Pen", icon: "draw-curve", key: "B", hint: "Click points the curve passes through · Double-click or Enter to end · Click the first to close" },
  { tool: "freehand", label: "Pencil", icon: "draw-pencil", key: "D", hint: "Draw freely; the stroke becomes a smooth curve you can edit · End near the start to close it" },
  { tool: "angle", label: "Angle", icon: "draw-angle", key: "Q", hint: "Click a point on one side, the vertex, then a point on the other side" },
  { tool: "node", label: "Node", icon: "draw-node", key: "O", hint: "Click to place a node and type its label · Join nodes with Arrow" },
  { tool: "label", label: "Text", icon: "text-size", key: "T", hint: "Click to place a label" },
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

interface DrawingPanelActions { tool(tool: Tool): void; select(key: string): void; insert(template: ShapeTemplate): void }

/** The label box a node gets in its palette icon, in px. */
const ICON_LABEL = { width: 26, height: 12 };
/** Size of a palette icon and the width its strokes are drawn at, in px. */
const ICON_PX = 22;
const ICON_STROKE_PX = 1.3;
/** An arrowhead (8 px long in the drawing) is about 6 px long in an icon. */
const ICON_ARROW_SCALE = 0.75;

/** A ready-made shape drawn as its own small picture: the same SVG the drawing gets, its strokes kept at icon width. */
function shapeIcon(t: ShapeTemplate): string {
  // A node gets an unseen label, so its outline has the proportions it has around text.
  const own = templateModel(t);
  const model = { ...own, points: own.points.map((p) => (p.shape ? { ...p, label: "x" } : p)) };
  const svg = formatDrawingSvg(model, layoutDrawing(model, () => ICON_LABEL), () => "");
  const [, , w = 1, h = 1] = (/viewBox="([^"]*)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  const perPx = Math.max(w, h) / ICON_PX;
  const round = (v: number): number => Math.round(v * 100) / 100;
  // Strokes and arrowheads keep their icon size, however large the shape is.
  return svg.replace(/^<svg width="[^"]*" height="[^"]*"/, `<svg width="${ICON_PX}" height="${ICON_PX}"`)
    .replace('stroke-width="0.8"', `stroke-width="${round(ICON_STROKE_PX * perPx)}"`)
    .replace(/(<use [^>]*rotate\([^)]*\))"/g, `$1 scale(${round(ICON_ARROW_SCALE * perPx)})"`);
}

export interface DrawingPanels { update(model: DrawingModel, tool: Tool, selection: ReadonlySet<string>): void }

/** Fills the left panel once: a strip of tools, the ready-made shapes by section (each click inserts one), and the list of the drawing's objects, which update() refreshes with the active tool. */
export function createDrawingPanels(left: HTMLElement, a: DrawingPanelActions): DrawingPanels {
  const toolButtons = TOOLS.map((t) => {
    const button = renderElement("button", { type: "button", class: "fe-tool", "aria-pressed": "false", "aria-label": t.label, title: `${t.label} (${t.key})`, html: renderIcon(t.icon) });
    button.addEventListener("click", () => a.tool(t.tool));
    return button;
  });
  const tools = wsSection("Tools");
  tools.body.append(renderElement("div", { class: "fe-tool-strip", role: "toolbar", "aria-label": "Drawing tools" }, ...toolButtons));
  const shapes = SHAPE_SECTIONS.map((section) => {
    const group = wsSection(section.name, { collapsible: true, open: section.id !== "solids" && section.id !== "plot" });
    group.body.append(renderElement("div", { class: "fe-shape-grid" }, ...SHAPES.filter((t) => t.section === section.id).map((t) => {
      const button = renderElement("button", { type: "button", class: "fe-shape", "aria-label": `Insert ${t.name}`, title: t.name, html: shapeIcon(t) });
      button.addEventListener("click", () => a.insert(t));
      return button;
    })));
    return group.element;
  });
  const objects = wsSection("Objects", { collapsible: true });
  left.replaceChildren(tools.element, ...shapes, objects.element);
  return {
    update(model, tool, selection) {
      toolButtons.forEach((button, i) => button.setAttribute("aria-pressed", String(TOOLS[i]!.tool === tool)));
      const list = renderElement("div", { class: "ws-list", role: "listbox", "aria-label": "Objects" }, ...drawingObjects(model).map((o) => wsListRow({ label: o.name, icon: o.icon, ...(o.colour ? { swatch: o.colour } : {}), selected: selection.has(o.key) }, { select: () => a.select(o.key) })));
      objects.body.replaceChildren(model.items.length + model.points.length === 0 ? renderElement("p", { class: "fe-hint", text: "Pick a tool or a shape." }) : list);
    },
  };
}
