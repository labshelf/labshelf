/** @jest-environment jsdom */
import { layoutDrawing, type DrawingLayout, type LabelBox } from "../../../src/qmd/drawing/layout";
import { sanitizeDrawingSvg } from "../../../src/qmd/drawing/sanitize";
import { formatDrawingSvg } from "../../../src/qmd/drawing/svg";

// Models are plain objects shaped as D2. Y is up; 1 grid unit is 18.9 CSS px.
type Model = Parameters<typeof layoutDrawing>[0];
type P = { id: string; x: number; y: number; label?: string; at?: string; dot?: boolean };
const model = (points: P[], items: unknown[] = []): Model => ({ v: 1, points: points.map((p) => ({ dot: false, ...p })), items }) as unknown as Model;
const measure = (tex: string): LabelBox => ({ width: 8 * tex.length + 4, height: 14 });
const seg = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ k: "seg", a, b, arrow: "none", ...extra });

// A label renderer whose output can be found again: a nested svg carrying its text in data-label.
const marker = (tex: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="10" data-label="${tex}"><path d="M0 0h1v1z"/></svg>`;
const PX = 18.9;

type M = [number, number, number, number, number, number];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const nums = (s: string) => (s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
function own(el: Element, root: Element): M {
  let m: M = [1, 0, 0, 1, 0, 0];
  if (el === root) {
    const vb = nums(el.getAttribute("viewBox") ?? "");
    const w = Number.parseFloat(el.getAttribute("width") ?? "");
    if (vb.length === 4 && w > 0 && (vb[2] ?? 0) > 0) {
      const s = w / (vb[2] ?? 1);
      m = [s, 0, 0, s, -(vb[0] ?? 0) * s, -(vb[1] ?? 0) * s];
    }
    return m;
  }
  if (el.localName === "svg") m = mul(m, [1, 0, 0, 1, Number.parseFloat(el.getAttribute("x") ?? "0") || 0, Number.parseFloat(el.getAttribute("y") ?? "0") || 0]);
  for (const t of (el.getAttribute("transform") ?? "").matchAll(/(translate|scale|matrix)\(([^)]*)\)/g)) {
    const a = nums(t[2] ?? "");
    if (t[1] === "translate") m = mul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]);
    else if (t[1] === "scale") m = mul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]);
    else m = mul(m, [a[0] ?? 1, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1, a[4] ?? 0, a[5] ?? 0]);
  }
  return m;
}
/** Position in root coordinates of a local point of an element. */
function abs(el: Element, root: Element, x = 0, y = 0): [number, number] {
  const chain: Element[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) chain.unshift(e);
  let m: M = [1, 0, 0, 1, 0, 0];
  for (const e of chain) m = mul(m, own(e, root));
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}
const parse = (svg: string): { root: Element; doc: Document } => {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  return { root: doc.documentElement, doc };
};
const inDefs = (el: Element) => el.closest("defs") !== null;
const labelPos = (svg: string, tex: string): [number, number] => {
  const { root } = parse(svg);
  const el = root.querySelector(`[data-label="${tex}"]`);
  if (!el) throw new Error(`no label ${tex} in the svg`);
  return abs(el, root);
};
const dotPositions = (svg: string): Array<[number, number]> => {
  const { root } = parse(svg);
  return [...root.querySelectorAll("circle")].filter((c) => !inDefs(c) && c.closest("[data-label]") === null).map((c) => abs(c, root, Number(c.getAttribute("cx")), Number(c.getAttribute("cy"))));
};

const build = (m: Model, renderLabel: (tex: string) => string = marker): { svg: string; layout: DrawingLayout } => {
  const layout = layoutDrawing(m, measure);
  return { svg: formatDrawingSvg(m, layout, renderLabel), layout };
};

describe("A8 formatDrawingSvg: output shape", () => {
  const m = model(
    [{ id: "a", x: 0, y: 0, label: "A", dot: true }, { id: "b", x: 6, y: 0, label: "B", dot: false }, { id: "o", x: 10, y: 4 }],
    [
      seg("a", "b", { arrow: "end", label: "f" }),
      { k: "circle", c: "a", r: 2 },
      { k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 1, sy: 1, ticks: true, xlabel: "t", ylabel: "v" },
      { k: "fn", axes: "ax", expr: "x" },
    ],
  );

  it("A8 is one line starting with <svg and ending with </svg>", () => {
    const { svg } = build(m);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).not.toMatch(/[\r\n]/);
  });

  it("A8 has no style attribute anywhere", () => {
    expect(build(m).svg).not.toMatch(/\sstyle\s*=/i);
  });

  it("A8 strips the style attributes of the rendered labels but keeps their shapes", () => {
    const mathjax = () => '<svg xmlns="http://www.w3.org/2000/svg" style="vertical-align: -0.5ex" width="2ex" height="1ex"><g style="fill: red"><path d="M7 7L8 8"/></g></svg>';
    const { svg } = build(m, mathjax);
    expect(svg).not.toMatch(/style\s*=/i);
    expect(svg).toContain("M7 7L8 8");
  });

  it("A4 produces markup the sanitizer accepts", () => {
    const { svg } = build(m);
    expect(sanitizeDrawingSvg(svg)).not.toBeNull();
  });

  it("A8 contains no script, event attribute or external reference", () => {
    const { svg } = build(m);
    expect(svg).not.toMatch(/<script|foreignObject|\son\w+\s*=|https?:/i);
  });

  it("A8 asks the label renderer for the labels of points, segments and axes", () => {
    const calls: string[] = [];
    build(m, (tex) => {
      calls.push(tex);
      return marker(tex);
    });
    for (const t of ["A", "B", "f", "t", "v"]) expect(calls).toContain(t);
  });

  it("A8 strokes in currentColor unless a colour is set", () => {
    const plain = build(model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }], [seg("a", "b")])).svg;
    const values = [...plain.matchAll(/stroke="([^"]*)"/g)].map((x) => x[1]);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((v) => v === "currentColor" || v === "none")).toBe(true);
    const red = build(model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }], [seg("a", "b", { style: { color: "red" } })])).svg;
    const redValues = [...red.matchAll(/stroke="([^"]*)"/g)].map((x) => x[1]);
    expect(redValues.some((v) => v !== "currentColor" && v !== "none")).toBe(true);
  });

  it("A8 draws an arrowhead as a path in defs reused with use, and none without an arrow", () => {
    const two = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }];
    const one = (arrow: string) => build(model(two, [seg("a", "b", { arrow })])).svg;
    const uses = (svg: string) => [...svg.matchAll(/<use\b[^>]*?(?:xlink:)?href="#([^"]+)"/g)].map((x) => x[1] ?? "");
    expect(uses(one("none")).length).toBe(0);
    expect(uses(one("end")).length).toBe(1);
    expect(uses(one("both")).length).toBe(2);
    const end = one("end");
    const id = uses(end)[0] ?? "";
    const { root } = parse(end);
    const target = root.querySelector(`[id="${id}"]`);
    expect(target?.closest("defs")).not.toBeNull();
    expect(target?.localName).toBe("path");
  });
});

describe("A3 formatDrawingSvg: layout anchors and geometry", () => {
  it("A3 places a default label to the right of and above its dot", () => {
    const { svg } = build(model([{ id: "a", x: 0, y: 0, label: "A", dot: true }]));
    const dot = dotPositions(svg)[0] ?? [0, 0];
    const [lx, ly] = labelPos(svg, "A");
    expect(lx).toBeGreaterThan(dot[0]);
    expect(ly).toBeLessThan(dot[1]);
  });

  it("A3 follows the anchor stored in the layout", () => {
    const m = model([{ id: "a", x: 0, y: 0, label: "A", dot: true }]);
    const layout = layoutDrawing(m, measure);
    const entry = layout.points.get("a");
    if (!entry) throw new Error("layout has no point a");
    entry.anchor = "below left" as typeof entry.anchor;
    const svg = formatDrawingSvg(m, layout, marker);
    const dot = dotPositions(svg)[0] ?? [0, 0];
    const [lx, ly] = labelPos(svg, "A");
    expect(lx).toBeLessThan(dot[0]);
    expect(ly).toBeGreaterThan(dot[1]);
  });

  it("A3 puts labels on the outer side of a horizontal segment's ends", () => {
    const { svg } = build(model([{ id: "a", x: 0, y: 0, label: "A", dot: true }, { id: "b", x: 6, y: 0, label: "B", dot: true }], [seg("a", "b")]));
    const dots = dotPositions(svg).sort((p, q) => p[0] - q[0]);
    expect(labelPos(svg, "A")[0]).toBeLessThan(dots[0]?.[0] ?? 0);
    expect(labelPos(svg, "B")[0]).toBeGreaterThan(dots[1]?.[0] ?? 0);
  });

  it("A3 puts labels above and below the ends of a vertical segment", () => {
    const { svg } = build(model([{ id: "a", x: 0, y: 0, label: "A", dot: true }, { id: "b", x: 0, y: 6, label: "B", dot: true }], [seg("a", "b")]));
    const dots = dotPositions(svg).sort((p, q) => p[1] - q[1]); // screen y grows downwards: top dot first
    expect(labelPos(svg, "B")[1]).toBeLessThan(dots[0]?.[1] ?? 0);
    expect(labelPos(svg, "A")[1]).toBeGreaterThan(dots[1]?.[1] ?? 0);
  });

  it("A3 draws a segment between the ends the layout gives, at 18.9 px per unit", () => {
    const m = model([{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }], [seg("a", "b")]);
    const layout = layoutDrawing(m, measure);
    const s = layout.segments.get(0);
    if (!s) throw new Error("layout has no segment 0");
    // shorten the segment in the layout: the svg must follow the layout, not the points
    const to = s.to as unknown;
    if (Array.isArray(to)) to[0] = 3;
    else (to as { x: number }).x = 3;
    const svg = formatDrawingSvg(m, layout, marker);
    const { root } = parse(svg);
    const el = [...root.querySelectorAll("line, path, polyline")].find((e) => !inDefs(e));
    if (!el) throw new Error("no segment element");
    let ends: [[number, number], [number, number]];
    if (el.localName === "line") {
      const g = (n: string) => Number(el.getAttribute(n));
      ends = [abs(el, root, g("x1"), g("y1")), abs(el, root, g("x2"), g("y2"))];
    } else {
      const v = nums(el.getAttribute("d") ?? el.getAttribute("points") ?? "");
      ends = [abs(el, root, v[0], v[1]), abs(el, root, v[v.length - 2], v[v.length - 1])];
    }
    expect(Math.hypot(ends[1][0] - ends[0][0], ends[1][1] - ends[0][1])).toBeCloseTo(3 * PX, 0);
  });
});
