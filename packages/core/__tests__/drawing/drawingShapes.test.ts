import { formatDrawingModel, mapRefs, parseDrawingModel, pointRefs, type DrawingModel } from "../../src/drawing/drawingModel";
import { layoutDrawing, PX_PER_UNIT } from "../../src/drawing/drawingLayout";
import { arcPath, curveControls, flattenPath, matrixTransform, ngonVertices, smoothPath, transformMatrix } from "../../src/drawing/drawingPath";
import { formatDrawingSvg } from "../../src/drawing/drawingSvg";
import { formatTikz } from "../../src/drawing/drawingTikz";

const measure = () => ({ width: 10, height: 14 });
const P = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, x, y, dot: false, ...extra });
const model = (points: unknown[], items: unknown[]) => ({ v: 1, points, items }) as unknown as DrawingModel;
const render = (m: DrawingModel) => {
  const layout = layoutDrawing(m, measure);
  return { layout, svg: formatDrawingSvg(m, layout, () => '<svg width="10px" height="14px"></svg>'), tikz: formatTikz(m, layout) };
};

describe("drawing model: the shape items and nodes", () => {
  const full = model(
    [P("a", 0, 0, { label: "A", shape: "circle", style: { color: "blue", fill: "red", opacity: 0.3 } }), P("b", 4, 0), P("c", 4, 3)],
    [
      { k: "seg", a: "a", b: "b", arrow: "end", marks: 2 },
      { k: "curve", pts: ["a", "b", "c"], closed: false, ctrl: [null, [1, 0, 0, -1]], arrow: "end" },
      { k: "ngon", c: "b", r: 2, n: 5, star: 0.4, tf: { rot: 90, skew: 20, sx: 2 } },
      { k: "ellipse", c: "c", rx: 3, ry: 1.5, tf: { rot: 30, sy: -1 } },
      { k: "arc", c: "a", r: 2, from: 0, to: 120, close: "sector" },
      { k: "angle", a: "a", o: "b", b: "c", r: 0.6, arcs: 2, label: "\\alpha" },
    ],
  );

  it("reads and writes every new kind and field unchanged", () => {
    expect(parseDrawingModel(formatDrawingModel(full))).toEqual(full);
  });

  it("rejects out-of-range values", () => {
    const bad = (item: unknown) => parseDrawingModel(JSON.stringify(model([P("a", 0, 0), P("b", 1, 0)], [item])));
    expect(bad({ k: "ngon", c: "a", r: 1, n: 2 })).toBeNull();
    expect(bad({ k: "ellipse", c: "a", rx: 1, ry: 1, tf: { skew: 89 } })).toBeNull();
    expect(bad({ k: "ellipse", c: "a", rx: 1, ry: 1, tf: { sx: 0 } })).toBeNull();
    expect(bad({ k: "arc", c: "a", r: 1, from: 90, to: 90 })).toBeNull();
    expect(bad({ k: "curve", pts: ["a", "b"], closed: false, ctrl: [null, null] })).toBeNull();
    expect(bad({ k: "seg", a: "a", b: "b", arrow: "none", marks: 4 })).toBeNull();
    expect(parseDrawingModel(JSON.stringify(model([P("a", 0, 0, { shape: "star" })], [])))).toBeNull();
  });

  it("names and renames the points of every kind", () => {
    for (const item of full.items) {
      const renamed = mapRefs(item, (id) => `${id}2`);
      expect(pointRefs(renamed)).toEqual(pointRefs(item).map((id) => `${id}2`));
    }
  });
});

describe("drawing paths", () => {
  it("splits a matrix back into the turn, slant and stretch it was made of", () => {
    for (const tf of [{ rot: 30, skew: 20, sx: 2, sy: 0.5 }, { rot: -120, skew: -40, sx: 1, sy: -1.5 }]) {
      const back = matrixTransform(transformMatrix(tf));
      for (const key of ["rot", "skew", "sx", "sy"] as const) { expect(back[key]).toBeCloseTo(tf[key], 6); }
    }
  });

  it("drops a neutral transform and keeps a turned circle as a path", () => {
    const m = parseDrawingModel(JSON.stringify(model([P("c", 0, 0)], [{ k: "circle", c: "c", r: 1, tf: { rot: 0, sx: 1 } }, { k: "circle", c: "c", r: 1, tf: { sx: 2 } }])))!;
    expect(m.items[0]).toEqual({ k: "circle", c: "c", r: 1 });
    const { svg, tikz } = render(m);
    expect(svg).toMatch(/<circle[^>]*r="18.9/);
    expect(svg).toMatch(/<path d="M37.8 0C/);
    expect(tikz).toContain("\\draw (pc) circle (1);");
  });

  it("draws a quarter arc as one cubic on the circle", () => {
    const path = arcPath({ x: 0, y: 0 }, 2, 2, 0, 0, 90);
    expect(path.segs).toHaveLength(1);
    for (const p of flattenPath(path)) { expect(Math.hypot(p.x, p.y)).toBeCloseTo(2, 2); }
  });

  it("puts a regular polygon's corners on its circle, a star's inner ones inside", () => {
    expect(ngonVertices({ x: 0, y: 0 }, 1, 6, 0).map((p) => Math.hypot(p.x, p.y))).toEqual(Array(6).fill(1).map(() => expect.closeTo(1, 6)));
    const star = ngonVertices({ x: 0, y: 0 }, 2, 5, 90, 0.5);
    expect(star).toHaveLength(10);
    expect(Math.hypot(star[1]!.x, star[1]!.y)).toBeCloseTo(1, 6);
  });

  it("passes a smooth curve through its points and keeps a set control point", () => {
    const pts = [{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 0 }];
    const path = smoothPath(pts, false, [null, [1, 1, 0, 2]]);
    expect(path.segs.map((s) => s.to)).toEqual([pts[1], pts[2]]);
    expect(curveControls(pts, false, [null, [1, 1, 0, 2]])[1]).toMatchObject({ c1: { x: 3, y: 3 }, c2: { x: 4, y: 2 } });
  });
});

describe("drawing layout, SVG and TikZ of the shapes", () => {
  it("stops an edge at a node's outline", () => {
    const m = model([P("a", 0, 0, { shape: "circle", label: "x" }), P("b", 6, 0)], [{ k: "seg", a: "a", b: "b", arrow: "end" }]);
    const { layout } = render(m);
    const node = layout.nodes.get("a")!;
    expect(layout.segments.get(0)!.from.x).toBeCloseTo(node.hw, 6);
    expect(node.hw * PX_PER_UNIT).toBeGreaterThan(Math.hypot(5, 7));
  });

  it("marks a right angle with a square and other angles with arcs", () => {
    const right = render(model([P("a", 2, 0), P("o", 0, 0), P("b", 0, 2)], [{ k: "angle", a: "a", o: "o", b: "b" }])).layout.shapes.get(0)!;
    expect(right.paths[0]!.segs.every((s) => s.k === "L")).toBe(true);
    const acute = render(model([P("a", 2, 0), P("o", 0, 0), P("b", 2, 2)], [{ k: "angle", a: "a", o: "o", b: "b", arcs: 2 }])).layout.shapes.get(0)!;
    expect(acute.paths).toHaveLength(2);
    expect(acute.paths[0]!.segs[0]!.k).toBe("C");
  });

  it("measures the angle on its side under 180 degrees", () => {
    const shape = render(model([P("a", 0, 2), P("o", 0, 0), P("b", 2, 0)], [{ k: "angle", a: "a", o: "o", b: "b", r: 1 }])).layout.shapes.get(0)!;
    for (const p of flattenPath(shape.paths[0]!)) { expect(p.x).toBeGreaterThanOrEqual(-1e-9); expect(p.y).toBeGreaterThanOrEqual(-1e-9); }
  });

  it("draws equal-length marks across a segment", () => {
    const { layout, tikz } = render(model([P("a", 0, 0, { dot: true }), P("b", 4, 0, { dot: true })], [{ k: "seg", a: "a", b: "b", arrow: "none", marks: 3 }]));
    expect(layout.shapes.get(0)!.paths).toHaveLength(3);
    expect(tikz.split("\n").filter((l) => /^\\draw \([\d.]+,-?[\d.]+\) -- /.test(l))).toHaveLength(3);
  });

  it("prints the same cubic pieces in SVG and in base TikZ", () => {
    const m = model([P("a", 0, 0), P("b", 2, 2), P("c", 4, 0)], [
      { k: "curve", pts: ["a", "b", "c"], closed: true, style: { fill: "blue", opacity: 0.4 } },
      { k: "ellipse", c: "b", rx: 2, ry: 1 },
      { k: "arc", c: "a", r: 1, from: 0, to: 270, arrow: "end" },
    ]);
    const { svg, tikz } = render(m);
    expect(svg).toMatch(/<path d="M[^"]*C[^"]*Z" fill="blue" fill-opacity="0.4"\/>/);
    expect(svg).toContain('href="#ls-arrow"');
    expect(svg).not.toMatch(/style=/);
    expect(tikz).toContain(".. controls");
    expect(tikz).toContain(".. cycle;");
    expect(tikz).toContain("fill opacity=0.4");
    expect(tikz).toMatch(/\\draw\[->\] \(1,0\) \.\. controls/);
    expect(tikz).not.toMatch(/usetikzlibrary|ellipse \(|arc\[/);
  });

  it("draws a node's outline and its label at its centre, without a dot", () => {
    const { svg, tikz } = render(model([P("a", 1, 1, { dot: true, shape: "box", label: "v" })], []));
    expect(tikz).not.toContain("\\fill (pa) circle");
    expect(tikz).toContain("\\node at (pa) {$v$};");
    expect(tikz).toMatch(/\\draw \([\d.]+,[\d.]+\) -- .* -- cycle;/);
    expect(svg).not.toMatch(/<circle[^>]*r="2"/);
  });
});
