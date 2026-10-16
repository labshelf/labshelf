// Places graph nodes with a deterministic force-directed layout (Fruchterman-Reingold) inside a box.

export interface LayoutBox {
  width: number;
  height: number;
  /** Distance every node keeps from the box's edges. */
  padding: number;
}

export interface Point {
  x: number;
  y: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GRAVITY = 0.05;
const DEFAULT_ITERATIONS = 150;

// Starting on a golden-angle spiral gives every node its own point without a random source, so the same input
// always yields the same picture.
function spiral(n: number, step: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const r = step * Math.sqrt(i + 0.5);
    return { x: r * Math.cos(i * GOLDEN_ANGLE), y: r * Math.sin(i * GOLDEN_ANGLE) };
  });
}

function repel(pos: Point[], disp: Point[], k2: number): void {
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      let dx = pos[i]!.x - pos[j]!.x;
      let dy = pos[i]!.y - pos[j]!.y;
      // Two nodes on one point would cancel out; part them along a fixed direction.
      if (dx === 0 && dy === 0) { dx = 0.01 * (j - i); dy = 0.01; }
      const f = k2 / (dx * dx + dy * dy);
      disp[i]!.x += dx * f; disp[i]!.y += dy * f;
      disp[j]!.x -= dx * f; disp[j]!.y -= dy * f;
    }
  }
}

function attract(pos: Point[], disp: Point[], edges: ReadonlyArray<readonly [number, number]>, k: number): void {
  for (const [a, b] of edges) {
    const dx = pos[a]!.x - pos[b]!.x;
    const dy = pos[a]!.y - pos[b]!.y;
    const f = Math.sqrt(dx * dx + dy * dy) / k;
    disp[a]!.x -= dx * f; disp[a]!.y -= dy * f;
    disp[b]!.x += dx * f; disp[b]!.y += dy * f;
  }
}

// Scales and centres the layout into the box as a whole, so nodes keep their relative places and stay apart.
function fit(pos: Point[], box: LayoutBox): Point[] {
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const innerW = Math.max(0, box.width - 2 * box.padding);
  const innerH = Math.max(0, box.height - 2 * box.padding);
  const scale = Math.min(maxX > minX ? innerW / (maxX - minX) : Infinity, maxY > minY ? innerH / (maxY - minY) : Infinity);
  const s = Number.isFinite(scale) ? scale : 0;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return pos.map((p) => ({ x: box.width / 2 + (p.x - cx) * s, y: box.height / 2 + (p.y - cy) * s }));
}

/**
 * Lays out `count` nodes joined by `edges` (pairs of node indexes).
 * @returns one point per node, in order, inside the box less its padding
 */
export function forceLayout(
  count: number,
  edges: ReadonlyArray<readonly [number, number]>,
  box: LayoutBox,
  iterations = DEFAULT_ITERATIONS,
): Point[] {
  if (count === 0) return [];
  const k = Math.sqrt((box.width * box.height) / count);
  const pos = spiral(count, k / 2);
  const start = Math.max(box.width, box.height) / 10;
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => ({ x: 0, y: 0 }));
    repel(pos, disp, k * k);
    attract(pos, disp, edges, k);
    const temperature = start * (1 - it / iterations);
    pos.forEach((p, i) => {
      const d = disp[i]!;
      d.x -= p.x * GRAVITY * k; d.y -= p.y * GRAVITY * k;
      const len = Math.sqrt(d.x * d.x + d.y * d.y);
      if (len === 0) return;
      const step = Math.min(len, temperature) / len;
      p.x += d.x * step; p.y += d.y * step;
    });
  }
  return fit(pos, box);
}
