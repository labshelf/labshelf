import { createEditorState, type EditorState, type Tool } from "../../../../src/qmd/dom/drawingEditor/state";
import { applyEvent, type EditorEvent } from "../../../../src/qmd/dom/drawingEditor/gestures";
import { dragHandle, itemHandles, shownModel } from "../../../../src/qmd/dom/drawingEditor/handles";
import type { DrawingModel } from "../../../../src/drawing/drawingModel";

const SCALE = 20;
type Loose = { points: Array<Record<string, unknown>>; items: Array<Record<string, any>> };
const loose = (s: EditorState | DrawingModel): Loose => ("model" in s ? s.model : s) as unknown as Loose;
const P = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, x, y, dot: true, ...extra });
const mk = (points: unknown[] = [], items: unknown[] = []) => ({ v: 1, points, items }) as unknown as DrawingModel;
const start = (model: DrawingModel, tool: Tool): EditorState => ({ ...createEditorState(model), tool });

const ptr = (type: "down" | "move" | "up" | "dblclick", x: number, y: number, m: { shift?: boolean; target?: unknown } = {}): EditorEvent =>
  ({ type, x, y, shift: m.shift ?? false, alt: false, mod: false, target: (m.target ?? null) as never });
const key = (k: string): EditorEvent => ({ type: "key", key: k, shift: false, mod: false });
const run = (s: EditorState, ...events: EditorEvent[]): EditorState => events.reduce((acc, e) => applyEvent(acc, e, SCALE), s);
const click = (x: number, y: number, m: { target?: unknown } = {}): EditorEvent[] => [ptr("down", x, y, m), ptr("up", x, y, m)];
const drag = (from: [number, number], to: [number, number], m: { shift?: boolean } = {}): EditorEvent[] => [ptr("down", ...from), ptr("move", ...to), ptr("up", ...to, m)];

describe("Polygon, Curve and Angle tools", () => {
  it("closes a polygon when its first corner is clicked again", () => {
    const s = run(start(mk(), "polygon"), ...click(0, 0), ...click(4, 0), ...click(2, 3), ...click(0, 0));
    expect(s.draft).toBeNull();
    const [poly] = loose(s).items;
    expect(poly).toMatchObject({ k: "poly", closed: true });
    expect(poly!.pts).toHaveLength(3);
    expect(loose(s).points).toHaveLength(3);
  });

  it("reuses an existing point a vertex snaps to", () => {
    const s = run(start(mk([P("p1", 0, 0)]), "polygon"), ...click(0.1, 0.1), ...click(4, 0), ...click(2, 3), key("Enter"));
    expect(loose(s).items[0]!.pts[0]).toBe("p1");
  });

  it("ends an open curve with Enter, and drops the last vertex with Backspace", () => {
    const s = run(start(mk(), "curve"), ...click(0, 0), ...click(2, 2), ...click(4, 0), ...click(6, 2), key("Backspace"), key("Enter"));
    expect(loose(s).items[0]).toMatchObject({ k: "curve", closed: false });
    expect(loose(s).items[0]!.pts).toHaveLength(3);
  });

  it("ends a curve on a double click without a doubled vertex", () => {
    const s = run(start(mk(), "curve"), ...click(0, 0), ...click(3, 1), ...click(5, 0), ptr("dblclick", 5, 0));
    expect(loose(s).items[0]!.pts).toHaveLength(3);
  });

  it("makes an angle mark from three clicks, the vertex second", () => {
    const s = run(start(mk([P("a", 3, 0), P("o", 0, 0), P("b", 0, 3)]), "angle"), ...click(3, 0, { target: { kind: "point", id: "a" } }), ...click(0, 0, { target: { kind: "point", id: "o" } }), ...click(0, 3, { target: { kind: "point", id: "b" } }));
    expect(loose(s).items).toEqual([{ k: "angle", a: "a", o: "o", b: "b" }]);
  });

  it("drops the vertices with Escape", () => {
    const s = run(start(mk(), "polygon"), ...click(0, 0), ...click(4, 0), key("Escape"));
    expect(s.draft).toBeNull();
    expect(loose(s).items).toHaveLength(0);
  });
});

describe("Regular polygon, Ellipse, Arc and Node tools", () => {
  it("drags a regular polygon from its centre, with the sides typed while dragging", () => {
    const s = run(start(mk(), "ngon"), ptr("down", 0, 0), ptr("move", 0, 2), key("5"), ptr("up", 0, 2));
    expect(loose(s).items[0]).toMatchObject({ k: "ngon", r: 2, n: 5, rot: 90 });
  });

  it("drags an ellipse from its centre; Shift keeps the radii equal", () => {
    expect(loose(run(start(mk(), "ellipse"), ...drag([0, 0], [3, 1]))).items[0]).toMatchObject({ k: "ellipse", rx: 3, ry: 1 });
    expect(loose(run(start(mk(), "ellipse"), ...drag([0, 0], [3, 1], { shift: true }))).items[0]).toMatchObject({ rx: 3, ry: 3 });
  });

  it("drags a quarter arc from its centre to its start", () => {
    expect(loose(run(start(mk(), "arc"), ...drag([0, 0], [0, 2]))).items[0]).toMatchObject({ k: "arc", r: 2, from: 90, to: 180 });
  });

  it("turns a click into a node with its label open", () => {
    const s = run(start(mk(), "node"), ...click(2, 2));
    const [node] = loose(s).points;
    expect(node).toMatchObject({ x: 2, y: 2, shape: "circle", dot: false });
    expect(s.editingLabel).toBe(node!.id);
  });
});

describe("handles", () => {
  const seg = mk([P("a", 0, 0), P("b", 4, 0)], [{ k: "seg", a: "a", b: "b", arrow: "none" }]);

  it("bends a segment by its middle handle", () => {
    const [bend] = itemHandles(seg, 0);
    expect(bend).toMatchObject({ id: "bend", at: { x: 2, y: 0 } });
    expect(loose(dragHandle(seg, 0, "bend", { x: 2, y: 1 })).items[0]!.bend).toBe(45);
    expect(loose(dragHandle(seg, 0, "bend", { x: 2, y: 0 })).items[0]!.bend).toBeUndefined();
  });

  it("sets one control point of a curve and keeps the others automatic", () => {
    const curve = mk([P("a", 0, 0), P("b", 2, 2), P("c", 4, 0)], [{ k: "curve", pts: ["a", "b", "c"], closed: false }]);
    expect(itemHandles(curve, 0).map((h) => h.id)).toEqual(["c0a", "c0b", "c1a", "c1b"]);
    const ctrl = loose(dragHandle(curve, 0, "c1b", { x: 5, y: 2 })).items[0]!.ctrl;
    expect(ctrl[0]).toBeNull();
    expect(ctrl[1].slice(2)).toEqual([1, 2]);
  });

  it("moves an arc's end around its centre", () => {
    const arc = mk([P("c", 0, 0)], [{ k: "arc", c: "c", r: 2, from: 0, to: 90 }]);
    expect(loose(dragHandle(arc, 0, "to", { x: -2, y: 0 })).items[0]).toMatchObject({ from: 0, to: 180 });
    expect(loose(dragHandle(arc, 0, "from", { x: 0, y: -3 })).items[0]).toMatchObject({ r: 3, from: 270, to: 450 });
  });

  it("drags a handle with the Select tool: shown live, one model change on release", () => {
    const selected = { ...start(seg, "select"), selection: new Set(["i0"]) };
    const pressed = run(selected, ptr("down", 2, 0, { target: { kind: "handle", index: 0, handle: "bend" } }), ptr("move", 2, 1));
    expect(pressed.model).toBe(seg);
    expect(loose(shownModel(pressed)).items[0]!.bend).toBe(45);
    expect(loose(run(pressed, ptr("up", 2, 1))).items[0]!.bend).toBe(45);
  });
});
