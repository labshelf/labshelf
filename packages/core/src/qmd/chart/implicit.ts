// Marching squares for an implicit curve F(x, y) = 0 on a grid of cells over a view: the crossings of each cell's edges
// are joined into segments, and the segments are chained into polylines (closed ones end on their first point).

type Pt = [number, number];

/**
 * The zero set of `f` over `x` by `y` on a grid of `n` cells per axis, as polylines. A cell with a non-finite corner
 * draws nothing; a saddle cell is split by the sign at its centre. A closed curve returns with its first point repeated.
 */
export function marchingSquares(f: (x: number, y: number) => number, x: [number, number], y: [number, number], n: number): [number, number][][] {
  const cells = Math.max(1, Math.floor(n));
  const dx = (x[1] - x[0]) / cells;
  const dy = (y[1] - y[0]) / cells;
  const stride = cells + 1;
  const values = new Float64Array(stride * stride);
  for (let j = 0; j <= cells; j += 1) {
    for (let i = 0; i <= cells; i += 1) { values[j * stride + i] = f(x[0] + dx * i, y[0] + dy * j); }
  }
  const at = (i: number, j: number): number => values[j * stride + i]!;
  const positive = (v: number): boolean => v >= 0;

  const points = new Map<number, Pt>();
  const adjacent = new Map<number, number[]>();
  const hId = (i: number, j: number): number => j * cells + i;
  const vOffset = stride * cells;
  const vId = (i: number, j: number): number => vOffset + j * stride + i;

  // The crossing on the edge between nodes (i0, j0) and (i1, j1), made once per edge.
  const cross = (id: number, i0: number, j0: number, i1: number, j1: number): number => {
    if (!points.has(id)) {
      const a = at(i0, j0);
      const b = at(i1, j1);
      const t = a / (a - b);
      points.set(id, [x[0] + dx * (i0 + (i1 - i0) * t), y[0] + dy * (j0 + (j1 - j0) * t)]);
    }
    return id;
  };
  const link = (a: number, b: number): void => {
    adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
    adjacent.set(b, [...(adjacent.get(b) ?? []), a]);
  };

  for (let j = 0; j < cells; j += 1) {
    for (let i = 0; i < cells; i += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || !Number.isFinite(d)) { continue; }
      const pa = positive(a);
      const pb = positive(b);
      const pc = positive(c);
      const pd = positive(d);
      if (pa === pb && pb === pc && pc === pd) { continue; }
      // Edges: bottom a-b, right b-c, top d-c, left a-d.
      const crossing: number[] = [];
      const bottom = (): number => cross(hId(i, j), i, j, i + 1, j);
      const right = (): number => cross(vId(i + 1, j), i + 1, j, i + 1, j + 1);
      const top = (): number => cross(hId(i, j + 1), i, j + 1, i + 1, j + 1);
      const left = (): number => cross(vId(i, j), i, j, i, j + 1);
      if (pa !== pb) { crossing.push(bottom()); }
      if (pb !== pc) { crossing.push(right()); }
      if (pd !== pc) { crossing.push(top()); }
      if (pa !== pd) { crossing.push(left()); }
      if (crossing.length === 2) {
        link(crossing[0]!, crossing[1]!);
      } else if (crossing.length === 4) {
        const [bt, rt, tp, lf] = crossing as [number, number, number, number];
        if (positive((a + b + c + d) / 4) === pa) {
          link(bt, rt);
          link(tp, lf);
        } else {
          link(bt, lf);
          link(rt, tp);
        }
      }
    }
  }

  const visited = new Set<number>();
  const lines: Pt[][] = [];
  const walk = (start: number): Pt[] => {
    const line: Pt[] = [];
    let current: number | undefined = start;
    while (current !== undefined) {
      visited.add(current);
      line.push(points.get(current)!);
      current = adjacent.get(current)!.find((next) => !visited.has(next));
    }
    return line;
  };
  for (const [id, next] of adjacent) {
    if (next.length === 1 && !visited.has(id)) { lines.push(walk(id)); }
  }
  for (const id of adjacent.keys()) {
    if (visited.has(id)) { continue; }
    const line = walk(id);
    line.push(line[0]!);
    lines.push(line);
  }
  return lines.filter((line) => line.length >= 2);
}
