// TikZ printer (decision D4): writes a drawing model as a plain tikzpicture (no libraries, no TikZ math) from its layout.
// The caller wraps the text in D1's guard; the source hash of D1 is over this \n form.
import type { DrawingModel, Vec } from "./drawingModel.js";
import type { DrawingLayout } from "./drawingLayout.js";
import type { Path } from "./drawingPath.js";
import { nodePath, type ShapeLayout } from "./drawingShapes.js";

type DrawingItem = DrawingModel["items"][number];
type DrawingStyle = NonNullable<Extract<DrawingItem, { k: "seg" }>["style"]>;

const HEADER = "\\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]";
const FOOTER = "\\end{tikzpicture}";
/** Half the length of a tick mark, in grid units. */
const TICK = 0.15;
const DOT_RADIUS = "1.5pt";

/** Shortest decimal form, rounded to 1e-4, never -0 or exponent notation. */
function num(value: number): string {
  const rounded = Math.round(value * 1e4) / 1e4;
  return rounded === 0 ? "0" : rounded.toFixed(4).replace(/\.?0+$/, "");
}

function pt(v: Vec): string {
  return `(${num(v.x)},${num(v.y)})`;
}

function name(id: string): string {
  return `(p${id})`;
}

/** A point reference by name when `v` is still the point's position, else the coordinates. */
function ref(id: string, v: Vec, layout: DrawingLayout): string {
  const p = layout.points.get(id);
  return p && Math.abs(p.x - v.x) < 1e-9 && Math.abs(p.y - v.y) < 1e-9 ? name(id) : pt(v);
}

function options(list: Array<string | undefined>): string {
  const present = list.filter((o): o is string => o !== undefined && o !== "");
  return present.length > 0 ? `[${present.join(",")}]` : "";
}

function strokeOptions(style: DrawingStyle | undefined, withFill: boolean): string[] {
  if (!style) { return []; }
  const out: string[] = [];
  if (style.color) { out.push(style.color); }
  if (style.dash) { out.push(style.dash); }
  if (style.thick) { out.push("thick"); }
  if (withFill && style.fill) { out.push(`fill=${style.fill}`); }
  if (withFill && style.fill && style.opacity !== undefined) { out.push(`fill opacity=${num(style.opacity)}`); }
  return out;
}

function tex(label: string): string {
  return `{$${label}$}`;
}

/** A path as TikZ path operations: `--` for straight pieces, `.. controls .. ..` for cubic ones, `cycle` closing it. */
function pathOps(path: Path): string {
  let out = pt(path.start);
  path.segs.forEach((seg, i) => {
    const to = path.closed && i === path.segs.length - 1 ? "cycle" : pt(seg.to);
    out += seg.k === "L" ? ` -- ${to}` : ` .. controls ${pt(seg.c1)} and ${pt(seg.c2)} .. ${to}`;
  });
  return out;
}

/** One \draw per path of a shape item (arrow tips on the first), then its labels. */
function shapeLines(shape: ShapeLayout | undefined, style: DrawingStyle | undefined): string[] {
  if (!shape) { return []; }
  const arrow = shape.arrow === "end" ? "->" : shape.arrow === "both" ? "<->" : undefined;
  return [
    ...shape.paths.map((path, i) => `\\draw${options([i === 0 ? arrow : undefined, ...strokeOptions(style, shape.fill)])} ${pathOps(path)};`),
    ...shape.labels.map((l) => `\\node at ${pt(l.at)} ${tex(l.tex)};`),
  ];
}

function itemLines(item: DrawingItem, index: number, layout: DrawingLayout): string[] {
  switch (item.k) {
    case "seg": {
      const s = layout.segments.get(index);
      if (!s) { return []; }
      const arrow = item.arrow === "end" ? "->" : item.arrow === "both" ? "<->" : undefined;
      const opts = options([arrow, ...strokeOptions(item.style, false)]);
      const node = item.label !== undefined ? ` node[auto=${s.side}] ${tex(item.label)}` : "";
      const path = s.bend > 0 ? `to[bend left=${num(s.bend)}]` : s.bend < 0 ? `to[bend right=${num(-s.bend)}]` : "--";
      return [`\\draw${opts} ${ref(item.a, s.from, layout)} ${path}${node} ${ref(item.b, s.to, layout)};`, ...shapeLines(layout.shapes.get(index), item.style)];
    }
    case "curve": case "ngon": case "ellipse": case "arc": case "angle":
      return shapeLines(layout.shapes.get(index), item.style);
    case "circle":
      if (layout.shapes.has(index)) { return shapeLines(layout.shapes.get(index), item.style); }
      return [`\\draw${options(strokeOptions(item.style, true))} ${name(item.c)} circle (${num(item.r)});`];
    case "rect":
      return [`\\draw${options(strokeOptions(item.style, true))} ${name(item.a)} rectangle ${name(item.b)};`];
    case "poly":
      return [`\\draw${options(strokeOptions(item.style, true))} ${item.pts.map(name).join(" -- ")}${item.closed ? " -- cycle" : ""};`];
    case "text":
      return [`\\node at ${pt(item)} ${tex(item.tex)};`];
    case "axes":
      return axesLines(item, layout);
    case "fn": {
      const runs = layout.curves.get(index) ?? [];
      const opts = options(strokeOptions(item.style, false));
      return runs.filter((run) => run.length > 1).map((run, i, all) => {
        const label = item.label !== undefined && i === all.length - 1 ? ` node[right] ${tex(item.label)}` : "";
        return `\\draw${opts} plot coordinates {${run.map(pt).join(" ")}}${label};`;
      });
    }
  }
}

function axesLines(item: Extract<DrawingItem, { k: "axes" }>, layout: DrawingLayout): string[] {
  const a = layout.axes.get(item.id);
  if (!a) { return []; }
  // The axis lines cross at the origin, or at the nearest edge of the box when the origin lies outside it.
  const axisY = Math.min(a.to.y, Math.max(a.from.y, a.origin.y));
  const axisX = Math.min(a.to.x, Math.max(a.from.x, a.origin.x));
  const xLabel = item.xlabel !== undefined ? ` node[right] ${tex(item.xlabel)}` : "";
  const yLabel = item.ylabel !== undefined ? ` node[above] ${tex(item.ylabel)}` : "";
  return [
    `\\draw[->] ${pt({ x: a.from.x, y: axisY })} -- ${pt({ x: a.to.x, y: axisY })}${xLabel};`,
    `\\draw[->] ${pt({ x: axisX, y: a.from.y })} -- ${pt({ x: axisX, y: a.to.y })}${yLabel};`,
    ...a.xTicks.map((t) => `\\draw ${pt({ x: t.at.x, y: t.at.y + TICK })} -- ${pt({ x: t.at.x, y: t.at.y - TICK })}${t.label !== "" ? ` node[below] ${tex(t.label)}` : ""};`),
    ...a.yTicks.map((t) => `\\draw ${pt({ x: t.at.x + TICK, y: t.at.y })} -- ${pt({ x: t.at.x - TICK, y: t.at.y })}${t.label !== "" ? ` node[left] ${tex(t.label)}` : ""};`),
  ];
}

export function formatTikz(model: import("./drawingModel.js").DrawingModel, layout: import("./drawingLayout.js").DrawingLayout): string {
  const lines: string[] = [HEADER];
  for (const p of model.points) { lines.push(`\\coordinate ${name(p.id)} at ${pt(p)};`); }
  model.items.forEach((item, index) => { lines.push(...itemLines(item, index, layout)); });
  for (const p of model.points) {
    if (p.dot && p.shape === undefined) { lines.push(`\\fill ${name(p.id)} circle (${DOT_RADIUS});`); }
  }
  for (const p of model.points) {
    const node = layout.nodes.get(p.id);
    if (node) { lines.push(...shapeLines({ paths: [nodePath(p, node)], fill: true, labels: [] }, p.style)); }
    if (p.label === undefined || p.label === "") { continue; }
    // A dot-less labelled point and a node are shown by the label centred on it (segments stop short of the box or the
    // outline); a dotted one gets its label beside the dot at the layout's anchor.
    const anchor = p.dot && !node ? layout.points.get(p.id)?.anchor : undefined;
    lines.push(`\\node${options([anchor])} at ${name(p.id)} ${tex(p.label)};`);
  }
  lines.push(FOOTER);
  return lines.join("\n");
}
