import { forceLayout } from "../../../src/libraryUi/citationMap";

const BOX = { width: 640, height: 360, padding: 16 };

function chainAndStar(n: number): Array<readonly [number, number]> {
  const edges: Array<readonly [number, number]> = [];
  for (let i = 1; i < n; i++) edges.push([i % 7 === 0 ? 0 : i - 1, i]);
  return edges;
}

describe("forceLayout", () => {
  it("places the same graph at the same points every time", () => {
    const edges = chainAndStar(40);
    expect(forceLayout(40, edges, BOX)).toEqual(forceLayout(40, edges, BOX));
  });

  it("keeps every point finite and inside the box less its padding", () => {
    for (const n of [1, 2, 5, 60]) {
      for (const p of forceLayout(n, chainAndStar(n), BOX)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(BOX.padding - 1e-9);
        expect(p.x).toBeLessThanOrEqual(BOX.width - BOX.padding + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(BOX.padding - 1e-9);
        expect(p.y).toBeLessThanOrEqual(BOX.height - BOX.padding + 1e-9);
      }
    }
  });

  it("never puts two nodes on one point, edges or not", () => {
    for (const edges of [[], chainAndStar(30)]) {
      const points = forceLayout(30, edges, BOX);
      expect(new Set(points.map((p) => `${p.x},${p.y}`)).size).toBe(30);
    }
  });

  it("returns nothing for no nodes and lays out 300 nodes quickly", () => {
    expect(forceLayout(0, [], BOX)).toEqual([]);
    const started = Date.now();
    expect(forceLayout(300, chainAndStar(300), BOX)).toHaveLength(300);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
