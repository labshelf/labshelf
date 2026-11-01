import { layoutDrawing, PX_PER_UNIT, type DrawingLayout, type LabelBox } from "../../../src/qmd/drawing/layout";

// Models are plain objects shaped as D2. Y is up (as TikZ); coordinates are grid units.
type Model = Parameters<typeof layoutDrawing>[0];
type P = { id: string; x: number; y: number; label?: string; at?: string; dot?: boolean };

const model = (points: P[], items: unknown[] = []): Model => ({ v: 1, points: points.map((p) => ({ dot: true, ...p })), items }) as unknown as Model;

const measure = (tex: string): LabelBox => ({ width: 8 * tex.length + 4, height: 14 });
const layout = (m: Model, measureFn: (tex: string) => LabelBox = measure): DrawingLayout => layoutDrawing(m, measureFn);

// A Vec is {x, y} (model.ts); the helper also accepts a tuple so the tests read either.
const xy = (v: unknown): [number, number] => {
  if (Array.isArray(v)) return [Number(v[0]), Number(v[1])];
  const o = v as { x: number; y: number };
  return [o.x, o.y];
};
const dist = (a: unknown, b: unknown) => Math.hypot(xy(a)[0] - xy(b)[0], xy(a)[1] - xy(b)[1]);

const seg = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ k: "seg", a, b, arrow: "none", ...extra });

const anchorOf = (l: DrawingLayout, id: string) => l.points.get(id)?.anchor;

describe("A3 layoutDrawing: point label anchors", () => {
  it("A3 gives a point with no segments the anchor above right", () => {
    expect(anchorOf(layout(model([{ id: "a", x: 1, y: 2, label: "A" }])), "a")).toBe("above right");
  });

  it("A3 keeps the position of each point", () => {
    const l = layout(model([{ id: "a", x: 1.5, y: -2 }, { id: "b", x: 4, y: 0.25 }], [seg("a", "b")]));
    expect(l.points.get("a")).toMatchObject({ x: 1.5, y: -2 });
    expect(l.points.get("b")).toMatchObject({ x: 4, y: 0.25 });
  });

  it("A3 places the anchor opposite the single segment, one case per compass direction", () => {
    // neighbour direction -> expected anchor of the hub at the origin
    const cases: Array<[number, number, string]> = [
      [4, 0, "left"],
      [-4, 0, "right"],
      [0, 4, "below"],
      [0, -4, "above"],
      [4, 4, "below left"],
      [-4, 4, "below right"],
      [4, -4, "above left"],
      [-4, -4, "above right"],
    ];
    for (const [nx, ny, expected] of cases) {
      const l = layout(model([{ id: "h", x: 0, y: 0, label: "H" }, { id: "n", x: nx, y: ny }], [seg("h", "n")]));
      expect([nx, ny, anchorOf(l, "h")]).toEqual([nx, ny, expected]);
    }
  });

  it("A3 counts a segment at either of its ends", () => {
    const l = layout(model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }], [seg("a", "b")]));
    expect(anchorOf(l, "a")).toBe("left");
    expect(anchorOf(l, "b")).toBe("right");
  });

  it("A3 rounds the opposite direction to the nearest of the eight", () => {
    // neighbour at 14 deg: opposite 194 deg is nearest 180 (left); neighbour at 37 deg: opposite 217 deg is nearest 225 (below left)
    const flat = layout(model([{ id: "h", x: 0, y: 0 }, { id: "n", x: 4, y: 1 }], [seg("h", "n")]));
    expect(anchorOf(flat, "h")).toBe("left");
    const steep = layout(model([{ id: "h", x: 0, y: 0 }, { id: "n", x: 4, y: 3 }], [seg("h", "n")]));
    expect(anchorOf(steep, "h")).toBe("below left");
  });

  it("A3 uses the mean of several segments", () => {
    // one segment to the right and one up: mean points up-right, so the label goes below left
    const l = layout(model([{ id: "h", x: 0, y: 0 }, { id: "r", x: 4, y: 0 }, { id: "u", x: 0, y: 4 }], [seg("h", "r"), seg("h", "u")]));
    expect(anchorOf(l, "h")).toBe("below left");
  });

  it("A3 puts the vertex labels of a triangle outside it", () => {
    const l = layout(
      model(
        [{ id: "a", x: 0, y: 0, label: "A" }, { id: "b", x: 6, y: 0, label: "B" }, { id: "c", x: 3, y: 5, label: "C" }],
        [seg("a", "b"), seg("b", "c"), seg("c", "a")],
      ),
    );
    expect(anchorOf(l, "a")).toBe("below left");
    expect(anchorOf(l, "b")).toBe("below right");
    expect(anchorOf(l, "c")).toBe("above");
  });

  it("A3 lets an explicit at win over the computed anchor", () => {
    const l = layout(model([{ id: "a", x: 0, y: 0, at: "above" }, { id: "b", x: 4, y: 0 }], [seg("a", "b")]));
    expect(anchorOf(l, "a")).toBe("above");
    expect(anchorOf(l, "b")).toBe("right");
  });

  it("A3 ignores circles and rectangles when choosing an anchor", () => {
    const l = layout(model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }], [{ k: "rect", a: "a", b: "b" }]));
    expect(anchorOf(l, "a")).toBe("above right");
  });
});

describe("A3 layoutDrawing: segments", () => {
  const triangle = (items: unknown[]) => model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }, { id: "c", x: 2, y: 5 }], items);

  it("A3 puts the label on the side away from the centroid of all points", () => {
    // the centroid is above the base; travelling a to b, left is up, so away is right
    const l = layout(triangle([seg("a", "b")]));
    expect(l.segments.get(0)?.side).toBe("right");
  });

  it("A3 flips the side when the segment is traversed the other way", () => {
    const l = layout(triangle([seg("b", "a")]));
    expect(l.segments.get(0)?.side).toBe("left");
  });

  it("A3 breaks a tie toward the left of travel", () => {
    // the centroid (2, 0) lies on the segment
    const l = layout(model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }], [seg("a", "b")]));
    expect(l.segments.get(0)?.side).toBe("left");
  });

  it("A3 lets an explicit side win", () => {
    const l = layout(triangle([seg("a", "b", { side: "left" })]));
    expect(l.segments.get(0)?.side).toBe("left");
  });

  it("A3 keys segments by item index and skips other items", () => {
    const l = layout(triangle([{ k: "circle", c: "a", r: 1 }, seg("a", "b"), { k: "text", x: 1, y: 1, tex: "t" }, seg("b", "c")]));
    expect([...l.segments.keys()].sort()).toEqual([1, 3]);
  });

  it("A3 keeps the bend as given and uses 0 when there is none", () => {
    const l = layout(triangle([seg("a", "b", { bend: 25 }), seg("b", "c", { bend: -15 }), seg("c", "a")]));
    expect(l.segments.get(0)?.bend).toBe(25);
    expect(l.segments.get(1)?.bend).toBe(-15);
    expect(l.segments.get(2)?.bend).toBe(0);
  });

  it("A3 leaves the ends on the points when they are unlabelled", () => {
    const l = layout(triangle([seg("a", "b")]));
    const s = l.segments.get(0);
    expect(xy(s?.from)[0]).toBeCloseTo(0, 6);
    expect(xy(s?.from)[1]).toBeCloseTo(0, 6);
    expect(xy(s?.to)[0]).toBeCloseTo(4, 6);
    expect(xy(s?.to)[1]).toBeCloseTo(0, 6);
  });

  it("A3 stops a segment short of a labelled dot-less end, on the same line", () => {
    const m = model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 5, label: "B", dot: false }], [seg("a", "b")]);
    const s = layout(m).segments.get(0);
    expect(dist(s?.to, { x: 10, y: 5 })).toBeGreaterThan(0.05);
    expect(dist(s?.to, { x: 0, y: 0 })).toBeLessThan(dist({ x: 10, y: 5 }, { x: 0, y: 0 }));
    // still on the line y = x / 2
    expect(xy(s?.to)[1]).toBeCloseTo(xy(s?.to)[0] / 2, 4);
    // the unlabelled start is untouched
    expect(dist(s?.from, { x: 0, y: 0 })).toBeLessThan(1e-6);
  });

  it("A3 stops a segment short of a labelled dot-less start as well", () => {
    const m = model([{ id: "a", x: 0, y: 0, label: "A", dot: false }, { id: "b", x: 10, y: 0 }], [seg("a", "b")]);
    const s = layout(m).segments.get(0);
    expect(xy(s?.from)[0]).toBeGreaterThan(0.05);
    expect(xy(s?.from)[1]).toBeCloseTo(0, 6);
    expect(dist(s?.to, { x: 10, y: 0 })).toBeLessThan(1e-6);
  });

  it("A3 does not shorten at a labelled point that has a dot", () => {
    const m = model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 5, label: "B", dot: true }], [seg("a", "b")]);
    expect(dist(layout(m).segments.get(0)?.to, { x: 10, y: 5 })).toBeLessThan(1e-6);
  });

  it("A3 does not shorten at a dot-less point that has no label", () => {
    const m = model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 5, dot: false }], [seg("a", "b")]);
    expect(dist(layout(m).segments.get(0)?.to, { x: 10, y: 5 })).toBeLessThan(1e-6);
  });

  it("A3 shortens more for a bigger label box", () => {
    const m = model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0, label: "B", dot: false }], [seg("a", "b")]);
    const small = layout(m, () => ({ width: 10, height: 6 })).segments.get(0);
    const big = layout(m, () => ({ width: 60, height: 30 })).segments.get(0);
    expect(dist(big?.to, { x: 10, y: 0 })).toBeGreaterThan(dist(small?.to, { x: 10, y: 0 }));
    expect(dist(small?.to, { x: 10, y: 0 })).toBeGreaterThan(0);
  });

  it("A3 measures the label text of the points it shortens at", () => {
    const calls: string[] = [];
    const m = model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0, label: "Q_1", dot: false }], [seg("a", "b")]);
    layout(m, (tex) => {
      calls.push(tex);
      return { width: 20, height: 10 };
    });
    expect(calls.some((t) => t.includes("Q_1"))).toBe(true);
  });

  it("A3 gives the same result for the same input", () => {
    const m = triangle([seg("a", "b", { bend: 10 }), seg("b", "c")]);
    const one = layout(m);
    const two = layout(m);
    expect([...two.points]).toEqual([...one.points]);
    expect([...two.segments]).toEqual([...one.segments]);
  });
});

describe("A3 layoutDrawing: curves", () => {
  // Axes with the origin at point o = (10, 10); 2 grid units per math unit.
  const withFn = (expr: string, extra: Record<string, unknown> = {}, ranges: { x?: [number, number]; y?: [number, number] } = {}) =>
    model(
      [{ id: "o", x: 10, y: 10 }],
      [
        { k: "axes", id: "ax", o: "o", x: ranges.x ?? [-3, 3], y: ranges.y ?? [-3, 3], sx: 2, sy: 2, ticks: true },
        { k: "fn", axes: "ax", expr, ...extra },
      ],
    );

  const runs = (l: DrawingLayout, index: number): Array<Array<[number, number]>> => (l.curves.get(index) ?? []).map((run) => run.map(xy));

  it("A3 samples a function into grid units, o + (x*sx, y*sy)", () => {
    const r = runs(layout(withFn("x")), 1);
    expect(r.length).toBe(1);
    const pts = r[0] ?? [];
    expect(pts.length).toBeGreaterThan(10);
    for (const [gx, gy] of pts) expect(gx - 10).toBeCloseTo(gy - 10, 2);
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(4, 1);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(16, 1);
  });

  it("A3 scales x and y independently", () => {
    const m = model(
      [{ id: "o", x: 0, y: 0 }],
      [{ k: "axes", id: "ax", o: "o", x: [0, 4], y: [0, 10], sx: 3, sy: 0.5, ticks: true }, { k: "fn", axes: "ax", expr: "x" }],
    );
    const pts = runs(layout(m), 1)[0] ?? [];
    for (const [gx, gy] of pts) expect(gy).toBeCloseTo((gx / 3) * 0.5, 2);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(12, 1);
  });

  it("A3 restricts a curve to its domain", () => {
    const pts = runs(layout(withFn("x", { domain: [0, 2] })), 1)[0] ?? [];
    expect(Math.min(...pts.map((p) => p[0]))).toBeCloseTo(10, 1);
    expect(Math.max(...pts.map((p) => p[0]))).toBeCloseTo(14, 1);
  });

  it("A3 clips a curve to the y range of its axes", () => {
    const pts = runs(layout(withFn("x^2", {}, { y: [-1, 4] })), 1).flat();
    expect(pts.length).toBeGreaterThan(10);
    // y = x^2 reaches 4 at x = 2, so grid y stays at or below 10 + 4*2 = 18
    expect(Math.max(...pts.map((p) => p[1]))).toBeLessThanOrEqual(18 + 1e-6);
    expect(Math.min(...pts.map((p) => p[1]))).toBeGreaterThanOrEqual(8 - 1e-6);
  });

  it("A3 breaks the curve at an asymptote", () => {
    const r = runs(layout(withFn("1/x")), 1);
    expect(r.length).toBeGreaterThanOrEqual(2);
  });

  it("A3 gives a function whose expression does not parse no curve", () => {
    const l = layout(withFn("sin("));
    expect((l.curves.get(1) ?? []).length).toBe(0);
  });

  it("A3 keys curves by item index", () => {
    const m = model(
      [{ id: "o", x: 10, y: 10 }],
      [
        { k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 2, sy: 2, ticks: true },
        { k: "fn", axes: "ax", expr: "x" },
        { k: "fn", axes: "ax", expr: "-x" },
      ],
    );
    const l = layout(m);
    expect([...l.curves.keys()].sort()).toEqual([1, 2]);
    const second = runs(l, 2)[0] ?? [];
    for (const [gx, gy] of second) expect(gy - 10).toBeCloseTo(-(gx - 10), 2);
  });

  it("A3 lays out one entry per axes id", () => {
    const m = model(
      [{ id: "o", x: 10, y: 10 }, { id: "q", x: 30, y: 10 }],
      [
        { k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 2, sy: 2, ticks: true },
        { k: "axes", id: "bx", o: "q", x: [-3, 3], y: [-3, 3], sx: 2, sy: 2, ticks: true },
      ],
    );
    expect([...layout(m).axes.keys()].sort()).toEqual(["ax", "bx"]);
  });
});

describe("A3 layoutDrawing: tick labels and arrow tips", () => {
  const axesOf = (x: [number, number], y: [number, number], sx: number, sy: number) =>
    layout(model([{ id: "o", x: 0, y: 0 }], [{ k: "axes", id: "ax", o: "o", x, y, sx, sy, ticks: true }])).axes.get("ax")!;
  const labelled = (ticks: Array<{ label: string }>) => ticks.map((t) => t.label).filter((l) => l !== "");

  it("A3 keeps neighbouring x tick labels apart by their measured width", () => {
    const a = axesOf([-3, 3], [-3, 3], 1, 1);
    const xs = a.xTicks.filter((t) => t.label !== "").map((t) => t.at.x * PX_PER_UNIT);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(20);
  });

  it("A3 omits the tick label at the crossing and under the arrow tip", () => {
    const a = axesOf([1, 5], [-2, 2], 2, 2);
    // The y axis runs at x = 1 (0 is outside the range); x = 5 is the arrow tip.
    expect(labelled(a.xTicks)).not.toContain("1");
    expect(labelled(a.xTicks)).not.toContain("5");
    expect(labelled(a.yTicks)).not.toContain("2");
  });

  it("A3 drops a y tick label that would overlap an x tick label near the origin", () => {
    // x labels below the axis every 0.5; the y label "-1" sits left of the y axis 19 px down, where "-0.5" of the x axis is.
    const a = axesOf([-1, 1], [-1, 1], 4, 1);
    expect(labelled(a.xTicks)).toContain("-0.5");
    expect(labelled(a.yTicks)).not.toContain("-1");
  });

  it("A3 stops an arrow short of a dotted end point by the dot radius plus a gap", () => {
    const l = layout(model([{ id: "a", x: 0, y: 0, dot: true }, { id: "b", x: 4, y: 0, dot: true }], [{ k: "seg", a: "a", b: "b", arrow: "end" }]));
    const s = l.segments.get(0)!;
    expect(s.from.x).toBeCloseTo(0, 6);
    expect((4 - s.to.x) * PX_PER_UNIT).toBeGreaterThan(2);
    expect((4 - s.to.x) * PX_PER_UNIT).toBeLessThan(5);
  });
});
