/* eslint-disable @typescript-eslint/no-explicit-any */
import { createEditorState, type EditorState, type Tool } from "../../../../src/qmd/drawing/editor/state";
import { applyEvent, type EditorEvent } from "../../../../src/qmd/drawing/editor/gestures";
import type { DrawingModel } from "../../../../src/qmd/drawing/model";

// Models are plain objects shaped as D2. Scale is px per grid unit.
const SCALE = 20;

interface Loose {
  points: any[];
  items: any[];
}
const loose = (s: EditorState): Loose => s.model as unknown as Loose;
const pointOf = (s: EditorState, id: string) => loose(s).points.find((p) => p.id === id);
const itemsOf = (s: EditorState, kind: string) => loose(s).items.filter((i) => i.k === kind);

const P = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, x, y, dot: true, ...extra });
const seg = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ k: "seg", a, b, arrow: "none", ...extra });
const mk = (points: unknown[] = [], items: unknown[] = []) => ({ v: 1, points, items }) as unknown as DrawingModel;

const start = (model: DrawingModel, tool: Tool = "select"): EditorState => ({ ...createEditorState(model), tool });
const withSelection = (s: EditorState, ...ids: string[]): EditorState => ({ ...s, selection: new Set(ids) });

// Hit targets are produced by the DOM layer; these carry the same facts under the names a target is likely to use.
const hitPoint = (id: string) => ({ kind: "point", type: "point", id, point: id }) as never;
const hitItem = (index: number) => ({ kind: "item", type: "item", index, item: index }) as never;
const hitAxes = (id: string, index: number) => ({ kind: "axes", type: "axes", id, axes: id, index, item: index }) as never;

type Mods = { shift?: boolean; alt?: boolean; mod?: boolean; target?: unknown };
const ptr = (type: "down" | "move" | "up" | "dblclick", x: number, y: number, m: Mods = {}): EditorEvent => ({
  type,
  x,
  y,
  shift: m.shift ?? false,
  alt: m.alt ?? false,
  mod: m.mod ?? false,
  target: (m.target ?? null) as never,
});
const key = (k: string, m: { shift?: boolean; mod?: boolean } = {}): EditorEvent => ({ type: "key", key: k, shift: m.shift ?? false, mod: m.mod ?? false });
const run = (s: EditorState, ...events: EditorEvent[]) => events.reduce((state, event) => applyEvent(state, event, SCALE), s);
const click = (s: EditorState, x: number, y: number, m: Mods = {}) => run(s, ptr("down", x, y, m), ptr("up", x, y, m));
const angleOf = (from: { x: number; y: number }, to: { x: number; y: number }) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

const twoPoints = () => mk([P("p1", 2, 2), P("p2", 8, 2)]);

describe("A5 double-click makes a labelled point", () => {
  it("A5 double-click on empty canvas adds a point snapped to the grid", () => {
    const s = run(start(mk()), ptr("dblclick", 3.02, 4.03));
    expect(loose(s).points).toHaveLength(1);
    expect(loose(s).points[0].id).toBe("p1");
    expect(loose(s).points[0].x).toBeCloseTo(3, 1);
    expect(loose(s).points[0].y).toBeCloseTo(4, 1);
  });

  it("A5 double-click opens the label field of the new point", () => {
    const s = run(start(mk()), ptr("dblclick", 3, 4));
    expect(s.editingLabel).toBe(loose(s).points[0].id);
  });

  it("A5 Escape leaves the new point unlabelled and closes the field", () => {
    const s = run(start(mk()), ptr("dblclick", 3, 4), key("Escape"));
    expect(s.editingLabel).toBeNull();
    expect(loose(s).points).toHaveLength(1);
    expect(loose(s).points[0].label).toBeUndefined();
  });

  it("A5 Enter closes the label field and keeps the point", () => {
    const s = run(start(mk()), ptr("dblclick", 3, 4), key("Enter"));
    expect(s.editingLabel).toBeNull();
    expect(loose(s).points).toHaveLength(1);
  });

  it("A5 Tab moves the label field to the next point", () => {
    const s0 = { ...start(twoPoints()), editingLabel: "p1" };
    expect(run(s0, key("Tab")).editingLabel).toBe("p2");
  });

  it("A5 double-click on a segment opens its label field", () => {
    const s0 = start(mk([P("p1", 2, 2), P("p2", 8, 2)], [seg("p1", "p2")]));
    const s = run(s0, ptr("dblclick", 5, 2, { target: hitItem(0) }));
    expect(s.editingLabel).not.toBeNull();
    expect(loose(s).points).toHaveLength(2);
    expect(loose(s).items).toHaveLength(1);
  });

  it("A5 point ids are not reused after a delete", () => {
    const s0 = withSelection(start(mk([P("p1", 1, 1), P("p2", 2, 2), P("p3", 3, 3)])), "p2");
    const s = run(s0, key("Delete"), ptr("dblclick", 7, 7));
    const ids = loose(s).points.map((p) => p.id);
    expect(ids).toContain("p4");
    expect(ids).not.toContain("p2");
  });
});

describe("A5 Point tool", () => {
  it("A5 a click with the Point tool adds a point snapped to the grid", () => {
    const s = click(start(mk(), "point"), 3.02, 4.03);
    expect(loose(s).points).toHaveLength(1);
    expect(loose(s).points[0].x).toBeCloseTo(3, 1);
    expect(loose(s).points[0].y).toBeCloseTo(4, 1);
  });

  it("A5 a point clicked near a function curve is stored on the curve", () => {
    const m = mk(
      [P("p1", 10, 10)],
      [
        { k: "axes", id: "a1", o: "p1", x: [-5, 5], y: [-5, 20], sx: 2, sy: 2, ticks: true },
        { k: "fn", axes: "a1", expr: "x^2" },
      ],
    );
    const s = click(start(m, "point"), 12.1, 12.1);
    const added = loose(s).points.find((p) => p.id !== "p1");
    expect(added.on.item).toBe(1);
    expect(Math.abs(added.on.x - 1.05)).toBeLessThan(0.15);
    expect(added.y).toBeCloseTo(10 + 2 * added.on.x ** 2, 1);
  });

  it("A5 dragging a point stored on a curve moves it along the curve", () => {
    const m = mk(
      [P("p1", 10, 10), P("p2", 12, 12, { on: { item: 1, x: 1 } })],
      [
        { k: "axes", id: "a1", o: "p1", x: [-5, 5], y: [-5, 20], sx: 2, sy: 2, ticks: true },
        { k: "fn", axes: "a1", expr: "x^2" },
      ],
    );
    const s = run(start(m), ptr("down", 12, 12, { target: hitPoint("p2") }), ptr("move", 14, 18.2), ptr("up", 14, 18.2));
    const moved = pointOf(s, "p2");
    expect(moved.on.item).toBe(1);
    expect(Math.abs(moved.on.x - 2)).toBeLessThan(0.15);
    expect(moved.x).toBeCloseTo(10 + 2 * moved.on.x, 1);
    expect(moved.y).toBeCloseTo(10 + 2 * moved.on.x ** 2, 1);
  });
});

describe("A5 Line and Arrow tools", () => {
  it("A5 Arrow press on a point and release on another joins them with an arrow", () => {
    const s0 = start(twoPoints(), "arrow");
    const s = run(s0, ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 5, 2), ptr("up", 8, 2, { target: hitPoint("p2") }));
    expect(loose(s).points).toHaveLength(2);
    expect(loose(s).items).toHaveLength(1);
    expect(loose(s).items[0]).toMatchObject({ k: "seg", a: "p1", b: "p2", arrow: "end" });
  });

  it("A5 Line joins two points with a plain segment", () => {
    const s0 = start(twoPoints(), "line");
    const s = run(s0, ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("up", 8, 2, { target: hitPoint("p2") }));
    expect(loose(s).items[0]).toMatchObject({ k: "seg", a: "p1", b: "p2", arrow: "none" });
  });

  it("A5 releasing on empty space makes a new end point there", () => {
    const s0 = start(mk([P("p1", 2, 2)]), "arrow");
    const s = run(s0, ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 8.02, 3.01), ptr("up", 8.02, 3.01));
    expect(loose(s).points).toHaveLength(2);
    const end = loose(s).points.find((p) => p.id !== "p1");
    expect(end.x).toBeCloseTo(8, 1);
    expect(end.y).toBeCloseTo(3, 1);
    expect(loose(s).items[0]).toMatchObject({ k: "seg", a: "p1", b: end.id, arrow: "end" });
  });

  it("A5 holds the drag in the draft and leaves the model alone until release", () => {
    const s0 = start(twoPoints(), "arrow");
    const down = run(s0, ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 5, 2));
    expect(down.draft).not.toBeNull();
    expect(loose(down).items).toHaveLength(0);
    expect(loose(down).points).toHaveLength(2);
    const up = run(down, ptr("up", 8, 2, { target: hitPoint("p2") }));
    expect(up.draft).toBeNull();
  });

  it("A5 Escape cancels a drag in progress", () => {
    const s0 = start(twoPoints(), "arrow");
    const s = run(s0, ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 5, 2), key("Escape"));
    expect(s.draft).toBeNull();
    expect(loose(s).items).toHaveLength(0);
    expect(loose(s).points).toHaveLength(2);
  });

  it("A5 Shift snaps the new end point to 15 degrees from the start", () => {
    const s0 = start(mk([P("p1", 0, 0)]), "line");
    const shift = { shift: true };
    const s = run(s0, ptr("down", 0, 0, { target: hitPoint("p1") }), ptr("move", 5, 1.5, shift), ptr("up", 5, 1.5, shift));
    const end = loose(s).points.find((p) => p.id !== "p1");
    expect(Math.abs(angleOf({ x: 0, y: 0 }, end) - 15)).toBeLessThan(0.5);
  });
});

describe("A5 moving points", () => {
  const joined = () => mk([P("p1", 2, 2), P("p2", 8, 2)], [seg("p1", "p2", { arrow: "end" })]);

  it("A5 dragging a point moves it, snapped to the grid", () => {
    const s = run(start(joined()), ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 5.02, 5.03), ptr("up", 5.02, 5.03));
    expect(pointOf(s, "p1").x).toBeCloseTo(5, 1);
    expect(pointOf(s, "p1").y).toBeCloseTo(5, 1);
    expect(pointOf(s, "p2")).toMatchObject({ x: 8, y: 2 });
  });

  it("A5 a moved point carries its segments", () => {
    const s = run(start(joined()), ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 5, 5), ptr("up", 5, 5));
    expect(loose(s).items).toHaveLength(1);
    expect(loose(s).items[0]).toMatchObject({ k: "seg", a: "p1", b: "p2", arrow: "end" });
  });

  it("A5 Alt moves a point without snapping", () => {
    const alt = { alt: true };
    const s = run(start(joined()), ptr("down", 2, 2, { target: hitPoint("p1"), alt: true }), ptr("move", 5.03, 5.04, alt), ptr("up", 5.03, 5.04, alt));
    expect(pointOf(s, "p1").x).toBeCloseTo(5.03, 1);
    expect(pointOf(s, "p1").y).toBeCloseTo(5.04, 1);
  });

  it("A5 dragging one selected point moves the whole selection", () => {
    const s0 = withSelection(start(joined()), "p1", "p2");
    const s = run(s0, ptr("down", 2, 2, { target: hitPoint("p1") }), ptr("move", 5, 4), ptr("up", 5, 4));
    expect(pointOf(s, "p1").x).toBeCloseTo(5, 1);
    expect(pointOf(s, "p1").y).toBeCloseTo(4, 1);
    expect(pointOf(s, "p2").x).toBeCloseTo(11, 1);
    expect(pointOf(s, "p2").y).toBeCloseTo(4, 1);
  });
});

describe("A5 selection", () => {
  const three = () => mk([P("p1", 2, 2), P("p2", 4, 5), P("p3", 9, 9)], [seg("p1", "p2")]);

  it("A5 clicking a point selects it", () => {
    const s = click(start(three()), 2, 2, { target: hitPoint("p1") });
    expect([...s.selection]).toEqual(["p1"]);
  });

  it("A5 clicking another point replaces the selection", () => {
    const s = click(withSelection(start(three()), "p1"), 4, 5, { target: hitPoint("p2") });
    expect([...s.selection]).toEqual(["p2"]);
  });

  it("A5 Shift-click adds a point to the selection", () => {
    const s = click(withSelection(start(three()), "p1"), 4, 5, { target: hitPoint("p2"), shift: true });
    expect([...s.selection].sort()).toEqual(["p1", "p2"]);
  });

  it("A5 clicking a segment selects something", () => {
    const s = click(start(three()), 3, 3.5, { target: hitItem(0) });
    expect(s.selection.size).toBe(1);
  });

  it("A5 a marquee selects the points inside it", () => {
    const s = run(start(three()), ptr("down", 0, 0), ptr("move", 6, 6), ptr("up", 6, 6));
    expect([...s.selection].sort()).toEqual(["p1", "p2"]);
  });

  it("A5 clicking empty canvas clears the selection", () => {
    const s = click(withSelection(start(three()), "p1", "p2"), 15, 15);
    expect(s.selection.size).toBe(0);
  });
});

describe("A5 delete, duplicate and nudge", () => {
  const triangle = () => mk([P("p1", 1, 1), P("p2", 6, 1), P("p3", 3, 6)], [seg("p1", "p2"), seg("p2", "p3"), seg("p1", "p3")]);

  it("A5 Delete removes the selected point and the segments that touch it", () => {
    const s = run(withSelection(start(triangle()), "p2"), key("Delete"));
    expect(loose(s).points.map((p) => p.id)).toEqual(["p1", "p3"]);
    expect(loose(s).items).toHaveLength(1);
    expect(loose(s).items[0]).toMatchObject({ a: "p1", b: "p3" });
    expect(s.selection.size).toBe(0);
  });

  it("A5 Delete removes a selected segment and keeps its points", () => {
    const s = run(click(start(triangle()), 3.5, 1, { target: hitItem(0) }), key("Delete"));
    expect(loose(s).items).toHaveLength(2);
    expect(loose(s).points).toHaveLength(3);
  });

  it("A5 mod+D duplicates the selected points and the segments between them", () => {
    const s0 = withSelection(start(triangle()), "p1", "p2");
    const s = run(s0, key("d", { mod: true }));
    expect(loose(s).points).toHaveLength(5);
    expect(loose(s).items).toHaveLength(4);
    const ids = loose(s).points.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
    const copies = ids.filter((id) => !["p1", "p2", "p3"].includes(id));
    const copiedSeg = loose(s).items.find((i) => copies.includes(i.a) && copies.includes(i.b));
    expect(copiedSeg).toBeDefined();
    expect(pointOf(s, "p1")).toMatchObject({ x: 1, y: 1 });
    expect(pointOf(s, "p2")).toMatchObject({ x: 6, y: 1 });
  });

  it("A5 mod+D keeps the label of a duplicated point", () => {
    const s0 = withSelection(start(mk([P("p1", 1, 1, { label: "A" })])), "p1");
    const s = run(s0, key("d", { mod: true }));
    expect(loose(s).points).toHaveLength(2);
    expect(loose(s).points.filter((p) => p.label === "A")).toHaveLength(2);
  });

  it("A5 an arrow key nudges the selection one unit", () => {
    const s = run(withSelection(start(triangle()), "p1"), key("ArrowRight"));
    expect(pointOf(s, "p1").x).toBeCloseTo(2, 5);
    expect(pointOf(s, "p1").y).toBeCloseTo(1, 5);
    expect(pointOf(s, "p2").x).toBeCloseTo(6, 5);
  });

  it("A5 Shift and an arrow key nudge five units", () => {
    const s = run(withSelection(start(triangle()), "p1"), key("ArrowLeft", { shift: true }));
    expect(pointOf(s, "p1").x).toBeCloseTo(-4, 5);
  });

  it("A5 a vertical arrow key moves y by one unit and leaves x", () => {
    const s = run(withSelection(start(triangle()), "p1"), key("ArrowUp"));
    expect(pointOf(s, "p1").x).toBeCloseTo(1, 5);
    expect(Math.abs(pointOf(s, "p1").y - 1)).toBeCloseTo(1, 5);
  });
});

describe("A5 Function tool", () => {
  const withAxes = () =>
    mk(
      [P("p1", 10, 10)],
      [
        { k: "axes", id: "a1", o: "p1", x: [-5, 5], y: [-5, 5], sx: 2, sy: 2, ticks: true },
        { k: "fn", axes: "a1", expr: "x^2" },
      ],
    );

  it("A5 dragging a box makes axes and one function on them", () => {
    const s = run(start(mk(), "function"), ptr("down", 4, 4), ptr("move", 24, 16), ptr("up", 24, 16));
    expect(itemsOf(s, "axes")).toHaveLength(1);
    expect(itemsOf(s, "fn")).toHaveLength(1);
    expect(itemsOf(s, "fn")[0].axes).toBe(itemsOf(s, "axes")[0].id);
    expect(typeof itemsOf(s, "fn")[0].expr).toBe("string");
  });

  it("A5 the axes get ranges at one math unit per two grid units", () => {
    const s = run(start(mk(), "function"), ptr("down", 4, 4), ptr("move", 24, 16), ptr("up", 24, 16));
    const axes = itemsOf(s, "axes")[0];
    expect(Math.abs(axes.x[1] - axes.x[0])).toBeCloseTo(10, 1);
    expect(Math.abs(axes.y[1] - axes.y[0])).toBeCloseTo(6, 1);
    expect(axes.sx).toBeCloseTo(2, 5);
    expect(axes.sy).toBeCloseTo(2, 5);
  });

  it("A5 the origin of the new axes is inside the box", () => {
    const s = run(start(mk(), "function"), ptr("down", 4, 4), ptr("move", 24, 16), ptr("up", 24, 16));
    const axes = itemsOf(s, "axes")[0];
    const origin = typeof axes.o === "string" ? pointOf(s, axes.o) : axes.o;
    expect(origin.x).toBeGreaterThanOrEqual(4);
    expect(origin.x).toBeLessThanOrEqual(24);
    expect(origin.y).toBeGreaterThanOrEqual(4);
    expect(origin.y).toBeLessThanOrEqual(16);
  });

  it("A5 opens the expression field once the box is drawn", () => {
    const s = run(start(mk(), "function"), ptr("down", 4, 4), ptr("move", 24, 16), ptr("up", 24, 16));
    expect(s.editingLabel).not.toBeNull();
    expect(s.draft).toBeNull();
  });

  it("A5 a function dropped on existing axes shares them", () => {
    const s = click(start(withAxes(), "function"), 12, 12, { target: hitAxes("a1", 0) });
    expect(itemsOf(s, "axes")).toHaveLength(1);
    expect(itemsOf(s, "fn")).toHaveLength(2);
    expect(itemsOf(s, "fn").every((f) => f.axes === "a1")).toBe(true);
  });
});
