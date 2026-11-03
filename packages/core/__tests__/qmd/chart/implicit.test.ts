/**
 * Tests marchingSquares (plan charts, spec 5.2, D8): the zero set of F(x, y) on a grid of n cells per axis as polylines,
 * segments chained, with x^2 + y^2 - 1 giving a closed polyline near radius 1 (acceptance 5.2c).
 */
import { marchingSquares } from "../../../src/qmd/chart/implicit";

type Line = [number, number][];

const circle = (x: number, y: number): number => x * x + y * y - 1;

const length = (line: Line): number => {
  let sum = 0;
  for (let i = 1; i < line.length; i++) { sum += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]); }
  return sum;
};

const longest = (lines: Line[]): Line => lines.reduce((a, b) => (b.length > a.length ? b : a), [] as Line);

const gapBetweenEnds = (line: Line): number => {
  const a = line[0]!;
  const b = line[line.length - 1]!;
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
};

describe("5.2c marching squares on the unit circle", () => {
  const lines = marchingSquares(circle, [-2, 2], [-2, 2], 200);

  it("5.2c returns at least one polyline of finite points", () => {
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const line of lines) {
      expect(line.length).toBeGreaterThanOrEqual(2);
      for (const [x, y] of line) {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      }
    }
  });

  it("5.2c every point lies near radius 1", () => {
    for (const [x, y] of lines.flat()) { expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.02); }
  });

  it("5.2c the longest polyline closes on itself within a grid cell or two", () => {
    expect(gapBetweenEnds(longest(lines))).toBeLessThan(0.06);
  });

  it("5.2c the longest polyline runs round the whole circle", () => {
    const line = longest(lines);
    expect(length(line)).toBeGreaterThan(2 * Math.PI * 0.95);
    expect(length(line)).toBeLessThan(2 * Math.PI * 1.06);
    const xs = line.map(([x]) => x);
    const ys = line.map(([, y]) => y);
    expect(Math.min(...xs)).toBeLessThan(-0.97);
    expect(Math.max(...xs)).toBeGreaterThan(0.97);
    expect(Math.min(...ys)).toBeLessThan(-0.97);
    expect(Math.max(...ys)).toBeGreaterThan(0.97);
  });

  it("5.2c a coarser grid still gives points near the circle", () => {
    const coarse = marchingSquares(circle, [-2, 2], [-2, 2], 20);
    expect(coarse.length).toBeGreaterThanOrEqual(1);
    for (const [x, y] of coarse.flat()) { expect(Math.abs(Math.hypot(x, y) - 1)).toBeLessThan(0.1); }
  });
});

describe("5.2c marching squares on other functions", () => {
  it("5.2c a straight line x = 0.3 gives points on that line spanning the y range", () => {
    const lines = marchingSquares((x) => x - 0.3, [-2, 2], [-2, 2], 100);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const [x] of lines.flat()) { expect(x).toBeCloseTo(0.3, 3); }
    const ys = lines.flat().map(([, y]) => y);
    expect(Math.min(...ys)).toBeLessThan(-1.95);
    expect(Math.max(...ys)).toBeGreaterThan(1.95);
  });

  it("5.2c a function with no zero in the view gives no polyline", () => {
    expect(marchingSquares((x, y) => x * x + y * y + 1, [-2, 2], [-2, 2], 50)).toEqual([]);
    expect(marchingSquares(circle, [2, 4], [2, 4], 50)).toEqual([]);
  });

  it("5.2c two separate circles give two closed polylines", () => {
    const two = (x: number, y: number): number => ((x - 1.5) ** 2 + y * y - 0.25) * ((x + 1.5) ** 2 + y * y - 0.25);
    const lines = marchingSquares(two, [-3, 3], [-2, 2], 200).filter((l) => l.length > 10);
    expect(lines).toHaveLength(2);
    for (const line of lines) { expect(gapBetweenEnds(line)).toBeLessThan(0.1); }
    const centres = lines.map((l) => l.reduce((s, [x]) => s + x, 0) / l.length).sort((a, b) => a - b);
    expect(centres[0]).toBeCloseTo(-1.5, 1);
    expect(centres[1]).toBeCloseTo(1.5, 1);
  });
});
