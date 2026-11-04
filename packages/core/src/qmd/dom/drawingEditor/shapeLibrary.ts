// The ready-made shapes the drawing mode inserts with one click: lines, basic shapes, polygons, block arrows, flowchart nodes,
// solids (hidden edges dashed) and a function plot. Each is a small drawing in grid units around (0, 0) whose point ids are
// their indexes; inserting it gives fresh ids, centres it on the given place, groups it when it has several items, and
// selects it (a node opens its label, a plot its expression).
import { mapRefs, type DrawingModel, type NodeShape, type Vec } from "../../../drawing/index.js";
import { itemKey, r2, type EditorState, type IdSource, type Item, type Point } from "./state.js";

export type ShapeSection = 'lines' | 'basic' | 'polygons' | 'arrows' | 'flowchart' | 'solids' | 'plot';

/** `node`: the outline of a flowchart node, drawn around the label opened on insert. */
export interface ShapeTemplate { id: string; name: string; section: ShapeSection; points: ReadonlyArray<readonly [number, number]>; items: readonly Item[]; node?: NodeShape }

export const SHAPE_SECTIONS: ReadonlyArray<{ id: ShapeSection; name: string }> = [
  { id: "lines", name: "Lines" }, { id: "basic", name: "Basic shapes" }, { id: "polygons", name: "Polygons" }, { id: "arrows", name: "Arrows" },
  { id: "flowchart", name: "Flowchart" }, { id: "solids", name: "Solids" }, { id: "plot", name: "Plot" },
];

type XY = readonly [number, number];

const HIDDEN = { style: { dash: "dashed" as const } };
/** A flattened ellipse's ratio, for the bases and equators of solids. */
const FLAT = 0.3;

const seg = (a: number, b: number, extra: Partial<Extract<Item, { k: 'seg' }>> = {}): Item => ({ k: "seg", a: String(a), b: String(b), arrow: "none", ...extra });
/** A closed polygon through all the template's points, in order. */
const ring = (count: number): Item => ({ k: "poly", pts: Array.from({ length: count }, (_unused, i) => String(i)), closed: true });

function polygon(id: string, name: string, section: ShapeSection, points: readonly XY[]): ShapeTemplate {
  return { id, name, section, points, items: [ring(points.length)] };
}

/** A shape drawn around one centre point. */
function centred(id: string, name: string, section: ShapeSection, item: Item): ShapeTemplate {
  return { id, name, section, points: [[0, 0]], items: [item] };
}

function line(id: string, name: string, extra: Partial<Extract<Item, { k: 'seg' }>>): ShapeTemplate {
  return { id, name, section: "lines", points: [[-2, 0], [2, 0]], items: [seg(0, 1, extra)] };
}

/** The block arrow pointing right, turned a quarter `turns` times counter-clockwise. */
const RIGHT_ARROW: readonly XY[] = [[-2, -0.5], [0.5, -0.5], [0.5, -1.2], [2, 0], [0.5, 1.2], [0.5, 0.5], [-2, 0.5]];
const turned = (pts: readonly XY[], turns: number): XY[] => pts.map(([x, y]) => { let p: XY = [x, y]; for (let i = 0; i < turns; i++) { p = [-p[1], p[0]]; } return p; });

/** The flattened base or equator of a solid around point `c`: the front half solid, the back half dashed. */
const flatRing = (c: number, r: number): Item[] => [
  { k: "arc", c: String(c), r, from: 180, to: 360, tf: { sy: FLAT } },
  { k: "arc", c: String(c), r, from: 0, to: 180, tf: { sy: FLAT }, ...HIDDEN },
];

/** A box in oblique view: the front face and the back face shifted by (dx, dy); the three edges at the back bottom left are hidden. */
function box(id: string, name: string, w: number, h: number, dx: number, dy: number): ShapeTemplate {
  const [x0, y0] = [-(w + dx) / 2, -(h + dy) / 2];
  const front: XY[] = [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
  const back = front.map(([x, y]): XY => [x + dx, y + dy]);
  const items = [seg(0, 1), seg(1, 2), seg(2, 3), seg(3, 0), seg(3, 7), seg(2, 6), seg(7, 6), seg(1, 5), seg(5, 6), seg(0, 4, HIDDEN), seg(4, 5, HIDDEN), seg(4, 7, HIDDEN)];
  return { id, name, section: "solids", points: [...front, ...back], items };
}

/** A flowchart node: one point drawn with the given outline, its label open on insert. */
function node(id: string, name: string, shape: NodeShape): ShapeTemplate {
  return { id, name, section: "flowchart", points: [[0, 0]], items: [], node: shape };
}

export const SHAPES: readonly ShapeTemplate[] = [
  line("line", "Line", {}),
  line("arrow", "Arrow", { arrow: "end" }),
  line("double-arrow", "Double arrow", { arrow: "both" }),
  line("curved-arrow", "Curved arrow", { arrow: "end", bend: 35 }),
  { id: "curve", name: "Curve", section: "lines", points: [[-2, -1], [0, 1], [2, -1]], items: [{ k: "curve", pts: ["0", "1", "2"], closed: false }] },
  centred("circle", "Circle", "basic", { k: "circle", c: "0", r: 1.5 }),
  centred("ellipse", "Ellipse", "basic", { k: "ellipse", c: "0", rx: 2, ry: 1.2 }),
  polygon("square", "Square", "basic", [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]]),
  polygon("rectangle", "Rectangle", "basic", [[-2, -1.2], [2, -1.2], [2, 1.2], [-2, 1.2]]),
  polygon("triangle", "Triangle", "basic", [[-1.75, -1.5], [1.75, -1.5], [0, 1.5]]),
  polygon("right-triangle", "Right triangle", "basic", [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5]]),
  centred("semicircle", "Semicircle", "basic", { k: "arc", c: "0", r: 1.75, from: 0, to: 180, close: "chord" }),
  centred("sector", "Sector", "basic", { k: "arc", c: "0", r: 1.75, from: 0, to: 90, close: "sector" }),
  centred("arc", "Arc", "basic", { k: "arc", c: "0", r: 1.75, from: 30, to: 150 }),
  centred("pentagon", "Pentagon", "polygons", { k: "ngon", c: "0", r: 1.75, n: 5 }),
  centred("hexagon", "Hexagon", "polygons", { k: "ngon", c: "0", r: 1.75, n: 6 }),
  centred("octagon", "Octagon", "polygons", { k: "ngon", c: "0", r: 1.75, n: 8 }),
  centred("star", "Star", "polygons", { k: "ngon", c: "0", r: 1.75, n: 5, star: 0.45 }),
  centred("star-6", "Six-pointed star", "polygons", { k: "ngon", c: "0", r: 1.75, n: 6, star: 0.58 }),
  polygon("parallelogram", "Parallelogram", "polygons", [[-2, -1.2], [1.2, -1.2], [2, 1.2], [-1.2, 1.2]]),
  polygon("trapezoid", "Trapezoid", "polygons", [[-2, -1.2], [2, -1.2], [1.2, 1.2], [-1.2, 1.2]]),
  polygon("rhombus", "Rhombus", "polygons", [[0, -1.5], [2, 0], [0, 1.5], [-2, 0]]),
  polygon("cross", "Cross", "polygons", [[-0.5, -1.5], [0.5, -1.5], [0.5, -0.5], [1.5, -0.5], [1.5, 0.5], [0.5, 0.5], [0.5, 1.5], [-0.5, 1.5], [-0.5, 0.5], [-1.5, 0.5], [-1.5, -0.5], [-0.5, -0.5]]),
  polygon("arrow-right", "Right arrow", "arrows", RIGHT_ARROW),
  polygon("arrow-up", "Up arrow", "arrows", turned(RIGHT_ARROW, 1)),
  polygon("arrow-left", "Left arrow", "arrows", turned(RIGHT_ARROW, 2)),
  polygon("arrow-down", "Down arrow", "arrows", turned(RIGHT_ARROW, 3)),
  polygon("arrow-both", "Left and right arrow", "arrows", [[-2, 0], [-0.8, -1.2], [-0.8, -0.5], [0.8, -0.5], [0.8, -1.2], [2, 0], [0.8, 1.2], [0.8, 0.5], [-0.8, 0.5], [-0.8, 1.2]]),
  polygon("chevron", "Chevron", "arrows", [[-2, -1.2], [0.6, -1.2], [2, 0], [0.6, 1.2], [-2, 1.2], [-0.6, 0]]),
  polygon("pentagon-arrow", "Pentagon arrow", "arrows", [[-2, -1], [1, -1], [2, 0], [1, 1], [-2, 1]]),
  node("process", "Process", "box"),
  node("terminator", "Start or end", "round"),
  node("decision", "Decision", "diamond"),
  node("state", "State", "ellipse"),
  node("connector", "Connector", "circle"),
  box("cube", "Cube", 2.6, 2.6, 0.9, 0.9),
  box("cuboid", "Cuboid", 3.4, 1.8, 1, 0.8),
  { id: "tetrahedron", name: "Tetrahedron", section: "solids", points: [[-1.8, -1.2], [1.6, -1.4], [0.4, -0.4], [0, 1.8]], items: [seg(0, 1), seg(0, 3), seg(1, 3), seg(0, 2, HIDDEN), seg(1, 2, HIDDEN), seg(2, 3, HIDDEN)] },
  { id: "pyramid", name: "Square pyramid", section: "solids", points: [[-1.8, -1.3], [0.8, -1.3], [1.8, -0.5], [-0.8, -0.5], [0, 1.8]], items: [seg(0, 1), seg(1, 2), seg(4, 0), seg(4, 1), seg(4, 2), seg(2, 3, HIDDEN), seg(3, 0, HIDDEN), seg(4, 3, HIDDEN)] },
  { id: "prism", name: "Triangular prism", section: "solids", points: [[-1.8, -1.5], [1, -1.5], [-0.2, -0.8], [-1.8, 1], [1, 1], [-0.2, 1.7]], items: [seg(0, 1), seg(0, 3), seg(1, 4), seg(3, 4), seg(4, 5), seg(5, 3), seg(0, 2, HIDDEN), seg(1, 2, HIDDEN), seg(2, 5, HIDDEN)] },
  { id: "cylinder", name: "Cylinder", section: "solids", points: [[0, 1.3], [0, -1.3], [-1.5, 1.3], [-1.5, -1.3], [1.5, 1.3], [1.5, -1.3]], items: [{ k: "ellipse", c: "0", rx: 1.5, ry: 1.5 * FLAT }, ...flatRing(1, 1.5), seg(2, 3), seg(4, 5)] },
  { id: "cone", name: "Cone", section: "solids", points: [[0, -1.3], [0, 1.8], [-1.5, -1.3], [1.5, -1.3]], items: [...flatRing(0, 1.5), seg(1, 2), seg(1, 3)] },
  { id: "sphere", name: "Sphere", section: "solids", points: [[0, 0]], items: [{ k: "circle", c: "0", r: 1.6 }, ...flatRing(0, 1.6)] },
  { id: "plot", name: "Function plot", section: "plot", points: [[0, 0]], items: [{ k: "axes", id: "A", o: "0", x: [-4, 4], y: [-2.5, 2.5], sx: 1, sy: 1, ticks: true }, { k: "fn", axes: "A", expr: "sin(x)" }] },
  { id: "axes", name: "Axes", section: "plot", points: [[0, 0]], items: [{ k: "axes", id: "A", o: "0", x: [-4, 4], y: [-2.5, 2.5], sx: 1, sy: 1, ticks: true }] },
];

/** The template as a drawing of its own, for its palette icon. */
export function templateModel(t: ShapeTemplate): DrawingModel {
  return { v: 1, points: t.points.map(([x, y], i) => ({ id: String(i), x, y, dot: false, ...(t.node ? { shape: t.node } : {}) })), items: [...t.items] };
}

/** The state with the template inserted centred on `at`: fresh ids, grouped when it has several items, the Select tool on and the new shape selected (a node with its label open, a plot with its expression open). */
export function insertTemplate(state: EditorState, t: ShapeTemplate, at: Vec, ids: IdSource): EditorState {
  const own = templateModel(t);
  const pointIds = new Map(own.points.map((p) => [p.id, ids.take("p")]));
  const axesIds = new Map(own.items.flatMap((item) => (item.k === "axes" ? [[item.id, ids.take("a")] as const] : [])));
  const group = own.items.length > 1 ? ids.take("g") : undefined;
  const points: Point[] = own.points.map((p) => ({ ...p, id: pointIds.get(p.id)!, x: r2(at.x + p.x), y: r2(at.y + p.y) }));
  const items = own.items.map((item): Item => {
    const mapped = mapRefs(item, (id) => pointIds.get(id) ?? id);
    const withAxes: Item = mapped.k === "axes" ? { ...mapped, id: axesIds.get(mapped.id)! } : mapped.k === "fn" ? { ...mapped, axes: axesIds.get(mapped.axes)! } : mapped;
    return group ? { ...withAxes, g: group } : withAxes;
  });
  const base = state.model.items.length;
  const model = { ...state.model, points: [...state.model.points, ...points], items: [...state.model.items, ...items] };
  const keys = items.map((_item, i) => itemKey(base + i));
  const fn = items.findIndex((item) => item.k === "fn");
  const nodeId = t.node ? points[0]!.id : null;
  const editing = nodeId ?? (fn >= 0 ? itemKey(base + fn) : null);
  return { ...state, tool: "select", draft: null, model, selection: new Set(nodeId ? [nodeId] : keys), editingLabel: editing };
}

/** Where a template goes: `centre` on the grid, moved right a shape's width at a time while a point of the drawing falls within its box. */
export function insertPlace(model: DrawingModel, t: ShapeTemplate, centre: Vec): Vec {
  const xs = t.points.map(([x]) => x);
  const ys = t.points.map(([, y]) => y);
  // A shape drawn around one point (a circle, a polygon) is about four units across.
  const half = { x: Math.max(2, ...xs.map(Math.abs)), y: Math.max(2, ...ys.map(Math.abs)) };
  let at = { x: Math.round(centre.x) || 0, y: Math.round(centre.y) || 0 };
  const taken = (c: Vec): boolean => model.points.some((q) => Math.abs(q.x - c.x) <= half.x + 0.5 && Math.abs(q.y - c.y) <= half.y + 0.5);
  for (let i = 0; i < 20 && taken(at); i++) { at = { x: at.x + Math.ceil(2 * half.x + 1), y: at.y }; }
  return at;
}
