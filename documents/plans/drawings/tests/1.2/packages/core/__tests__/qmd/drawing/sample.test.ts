// Tests the adaptive function sampler (decision D9): 64 intervals, subdivision at sharp turns, breaks at non-finite values and jumps taller than the range, clipping to the range, 4 significant digits; the sampling half of acceptance A6.
import { sampleFunction } from "../../../src/qmd/drawing/sample";

type Runs = ReturnType<typeof sampleFunction>;

const count = (runs: Runs): number => runs.reduce((n, run) => n + run.length, 0);
const rounded4 = (v: number): boolean => Number(v.toPrecision(4)) === v;

describe("A6 sampling a smooth function", () => {
  it("A6 takes 64 equal intervals of a straight line, 65 points in one run", () => {
    const runs = sampleFunction((x) => x / 3, [0, 64], [-100, 100]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(65);
    expect(runs[0]![0]).toEqual([0, 0]);
    expect(runs[0]![1]).toEqual([1, 0.3333]);
    expect(runs[0]![63]).toEqual([63, 21]);
    expect(runs[0]![64]).toEqual([64, 21.33]);
  });

  it("A6 takes 65 points of a constant function", () => {
    const runs = sampleFunction(() => 0, [-2, 2], [-1, 1]);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toHaveLength(65);
    expect(runs[0]!.every(([, y]) => y === 0)).toBe(true);
    expect(runs[0]![0]![0]).toBe(-2);
    expect(runs[0]![64]![0]).toBe(2);
  });

  it("A6 rounds every coordinate to 4 significant digits", () => {
    const runs = sampleFunction((x) => Math.PI * x, [0, 640], [-1e6, 1e6]);
    expect(count(runs)).toBeGreaterThan(0);
    expect(runs.flat().every(([x, y]) => rounded4(x) && rounded4(y))).toBe(true);
    expect(runs[0]![1]).toEqual([10, 31.42]);
  });

  it("A6 returns the runs as arrays of [x, y] pairs", () => {
    const runs = sampleFunction((x) => x, [0, 1], [-1, 1]);
    expect(Array.isArray(runs)).toBe(true);
    expect(Array.isArray(runs[0])).toBe(true);
    expect(runs[0]![0]).toHaveLength(2);
  });
});

describe("A6 sampling subdivides sharp turns", () => {
  it("A6 adds points at a kink", () => {
    const runs = sampleFunction((x) => Math.abs(x), [-1, 1], [-2, 2]);
    expect(count(runs)).toBeGreaterThan(65);
  });

  it("A6 adds points along a fast oscillation and keeps x increasing", () => {
    const runs = sampleFunction((x) => Math.sin(50 * x), [0, 1], [-2, 2]);
    expect(runs).toHaveLength(1);
    expect(count(runs)).toBeGreaterThan(65);
    const xs = runs[0]!.map(([x]) => x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(1);
  });

  it("A6 stops at 400 points by default", () => {
    const runs = sampleFunction((x) => Math.sin(2000 * x), [0, 1], [-2, 2]);
    expect(count(runs)).toBeGreaterThan(65);
    expect(count(runs)).toBeLessThanOrEqual(400);
  });

  it("A6 stops at maxPoints when it is given", () => {
    const runs = sampleFunction((x) => Math.sin(2000 * x), [0, 1], [-2, 2], 100);
    expect(count(runs)).toBeGreaterThan(65);
    expect(count(runs)).toBeLessThanOrEqual(100);
  });

  it("A6 uses a larger maxPoints when it is given", () => {
    const runs = sampleFunction((x) => Math.sin(2000 * x), [0, 1], [-2, 2], 800);
    expect(count(runs)).toBeGreaterThan(400);
    expect(count(runs)).toBeLessThanOrEqual(800);
  });
});

describe("A6 sampling breaks runs", () => {
  it("A6 breaks 1/x at the pole and clips both branches to the range", () => {
    const runs = sampleFunction((x) => 1 / x, [-1, 1], [-10, 10]);
    expect(runs).toHaveLength(2);
    const [left, right] = runs as [Runs[number], Runs[number]];
    expect(left.every(([x]) => x < 0)).toBe(true);
    expect(right.every(([x]) => x > 0)).toBe(true);
    expect(runs.flat().every(([, y]) => y >= -10 && y <= 10)).toBe(true);
    const leftEnd = left.at(-1)!;
    expect(leftEnd[1]).toBe(-10);
    expect(leftEnd[0]).toBeGreaterThanOrEqual(-0.125);
    expect(leftEnd[0]).toBeLessThanOrEqual(-0.09);
    const rightStart = right[0]!;
    expect(rightStart[1]).toBe(10);
    expect(rightStart[0]).toBeGreaterThanOrEqual(0.09);
    expect(rightStart[0]).toBeLessThanOrEqual(0.125);
  });

  it("A6 breaks tan at its asymptote and draws no line across the box", () => {
    const runs = sampleFunction(Math.tan, [0, Math.PI], [-5, 5]);
    expect(runs).toHaveLength(2);
    const [rising, after] = runs as [Runs[number], Runs[number]];
    expect(rising[0]).toEqual([0, 0]);
    expect(rising.at(-1)![1]).toBe(5);
    expect(rising.at(-1)![0]).toBeLessThan(Math.PI / 2);
    expect(after[0]![1]).toBe(-5);
    expect(after[0]![0]).toBeGreaterThan(Math.PI / 2);
    expect(after.at(-1)![0]).toBe(3.142);
    for (const run of runs) {
      for (let i = 1; i < run.length; i += 1) { expect(Math.abs(run[i]![1] - run[i - 1]![1])).toBeLessThanOrEqual(10.01); }
    }
  });

  it("A6 breaks where the function is not a number", () => {
    const runs = sampleFunction((x) => (x > 0.3 && x < 0.7 ? Number.NaN : x), [0, 1], [-2, 2]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.every(([x]) => x <= 0.3)).toBe(true);
    expect(runs[1]!.every(([x]) => x >= 0.7)).toBe(true);
    expect(runs[0]![0]).toEqual([0, 0]);
    expect(runs[1]!.at(-1)).toEqual([1, 1]);
  });

  it("A6 starts the run where sqrt(x) begins to exist", () => {
    const runs = sampleFunction(Math.sqrt, [-1, 1], [-2, 2]);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]).toEqual([0, 0]);
    expect(runs[0]!.every(([x]) => x >= 0)).toBe(true);
  });

  it("A6 breaks at a jump taller than the range instead of joining across it", () => {
    const runs = sampleFunction((x) => (x < 0.5 ? 100 : -100), [0, 1], [-5, 5]);
    expect(count(runs)).toBe(0);
  });

  it("A6 keeps a step that is no taller than the range as one run", () => {
    const runs = sampleFunction((x) => (x < 0.5 ? -4 : 4), [0, 1], [-5, 5]);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]).toEqual([0, -4]);
    expect(runs[0]!.at(-1)).toEqual([1, 4]);
  });
});

describe("A6 sampling clips to the range", () => {
  it("A6 ends a line at the range with the crossing point interpolated", () => {
    const runs = sampleFunction((x) => 10 * x, [-1, 1], [-2, 2]);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]).toEqual([-0.2, -2]);
    expect(runs[0]!.at(-1)).toEqual([0.2, 2]);
    expect(runs[0]!.every(([, y]) => y >= -2 && y <= 2)).toBe(true);
  });

  it("A6 keeps every point inside the range for a parabola that leaves it", () => {
    const runs = sampleFunction((x) => x * x, [-3, 3], [0, 4]);
    expect(runs).toHaveLength(1);
    expect(runs.flat().every(([x, y]) => y >= 0 && y <= 4 && x >= -3 && x <= 3)).toBe(true);
    expect(runs[0]![0]![1]).toBe(4);
    expect(runs[0]![0]![0]).toBeGreaterThanOrEqual(-2);
    expect(runs[0]![0]![0]).toBeLessThan(-1.9);
    expect(runs[0]!.at(-1)![1]).toBe(4);
    expect(runs[0]!.at(-1)![0]).toBeGreaterThan(1.9);
    expect(runs[0]!.at(-1)![0]).toBeLessThanOrEqual(2);
  });

  it("A6 returns no points for a function wholly outside the range", () => {
    expect(count(sampleFunction(() => 100, [0, 1], [-1, 1]))).toBe(0);
  });

  it("A6 returns no points for a function that is never a number", () => {
    expect(count(sampleFunction(() => Number.NaN, [0, 1], [-1, 1]))).toBe(0);
  });
});
