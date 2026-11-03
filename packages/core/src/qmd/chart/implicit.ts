// Marching squares for an implicit curve F(x, y) = 0 on a grid of cells over a view: the crossings of each cell's edges
// are joined into segments, and the segments are chained into polylines (closed ones end on their first point).

type Pt = [number, number];

type Fn2 = (x: number, y: number) => number;
type Grid = { x: [number, number]; y: [number, number]; cells: number; dx: number; dy: number; stride: number; values: Float64Array };
/** The crossing points by edge id and the links between crossings of one cell. */
type Crossings = { points: Map<number, Pt>; adjacent: Map<number, number[]> };

const positive = (v: number): boolean => v >= 0;

function sampleGrid(f: Fn2, x: [number, number], y: [number, number], n: number): Grid {
  const cells = Math.max(1, Math.floor(n));
  const dx = (x[1] - x[0]) / cells;
  const dy = (y[1] - y[0]) / cells;
  const stride = cells + 1;
  const values = new Float64Array(stride * stride);
  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) { values[j * stride + i] = f(x[0] + dx * i, y[0] + dy * j); }
  }
  return { x, y, cells, dx, dy, stride, values };
}

const valueAt = (g: Grid, i: number, j: number): number => g.values[j * g.stride + i]!;

// The crossing on the edge between nodes (i0, j0) and (i1, j1), made once per edge.
function cross(g: Grid, c: Crossings, id: number, i0: number, j0: number, i1: number, j1: number): number {
  if (!c.points.has(id)) {
    const a = valueAt(g, i0, j0);
    const b = valueAt(g, i1, j1);
    const t = a / (a - b);
    c.points.set(id, [g.x[0] + g.dx * (i0 + (i1 - i0) * t), g.y[0] + g.dy * (j0 + (j1 - j0) * t)]);
  }
  return id;
}

function link(c: Crossings, a: number, b: number): void {
  c.adjacent.set(a, [...(c.adjacent.get(a) ?? []), b]);
  c.adjacent.set(b, [...(c.adjacent.get(b) ?? []), a]);
}

// The ids of the edges of cell (i, j) whose ends differ in sign, in the order bottom, right, top, left.
function cellCrossings(g: Grid, c: Crossings, i: number, j: number, signs: boolean[]): number[] {
  const [pa, pb, pc, pd] = signs as [boolean, boolean, boolean, boolean];
  const hId = (ci: number, cj: number): number => cj * g.cells + ci;
  const vId = (ci: number, cj: number): number => g.stride * g.cells + cj * g.stride + ci;
  const crossing: number[] = [];
  // Edges: bottom a-b, right b-c, top d-c, left a-d.
  if (pa !== pb) { crossing.push(cross(g, c, hId(i, j), i, j, i + 1, j)); }
  if (pb !== pc) { crossing.push(cross(g, c, vId(i + 1, j), i + 1, j, i + 1, j + 1)); }
  if (pd !== pc) { crossing.push(cross(g, c, hId(i, j + 1), i, j + 1, i + 1, j + 1)); }
  if (pa !== pd) { crossing.push(cross(g, c, vId(i, j), i, j, i, j + 1)); }
  return crossing;
}

// Joins the crossings of one cell into one segment, or two for a saddle split by the sign at the centre.
function linkCell(g: Grid, c: Crossings, i: number, j: number): void {
  const a = valueAt(g, i, j);
  const b = valueAt(g, i + 1, j);
  const cv = valueAt(g, i + 1, j + 1);
  const d = valueAt(g, i, j + 1);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(cv) || !Number.isFinite(d)) { return; }
  const signs = [positive(a), positive(b), positive(cv), positive(d)];
  if (signs[0] === signs[1] && signs[1] === signs[2] && signs[2] === signs[3]) { return; }
  const crossing = cellCrossings(g, c, i, j, signs);
  if (crossing.length === 2) {
    link(c, crossing[0]!, crossing[1]!);
  } else if (crossing.length === 4) {
    const [bt, rt, tp, lf] = crossing as [number, number, number, number];
    if (positive((a + b + cv + d) / 4) === signs[0]) {
      link(c, bt, rt);
      link(c, tp, lf);
    } else {
      link(c, bt, lf);
      link(c, rt, tp);
    }
  }
}

// Chains the links into polylines: open ones from their ends, then closed ones (first point repeated).
function chain(c: Crossings): Pt[][] {
  const visited = new Set<number>();
  const lines: Pt[][] = [];
  const walk = (start: number): Pt[] => {
    const line: Pt[] = [];
    let current: number | undefined = start;
    while (current !== undefined) {
      visited.add(current);
      line.push(c.points.get(current)!);
      current = c.adjacent.get(current)!.find((next) => !visited.has(next));
    }
    return line;
  };
  for (const [id, next] of c.adjacent) {
    if (next.length === 1 && !visited.has(id)) { lines.push(walk(id)); }
  }
  for (const id of c.adjacent.keys()) {
    if (visited.has(id)) { continue; }
    const line = walk(id);
    line.push(line[0]!);
    lines.push(line);
  }
  return lines.filter((line) => line.length >= 2);
}

/**
 * The zero set of `f` over `x` by `y` on a grid of `n` cells per axis, as polylines. A cell with a non-finite corner
 * draws nothing; a saddle cell is split by the sign at its centre. A closed curve returns with its first point repeated.
 */
export function marchingSquares(f: Fn2, x: [number, number], y: [number, number], n: number): [number, number][][] {
  const grid = sampleGrid(f, x, y, n);
  const crossings: Crossings = { points: new Map(), adjacent: new Map() };
  for (let j = 0; j < grid.cells; j += 1) {
    for (let i = 0; i < grid.cells; i += 1) { linkCell(grid, crossings, i, j); }
  }
  return chain(crossings);
}
