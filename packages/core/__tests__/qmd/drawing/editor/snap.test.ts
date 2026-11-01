import { snapPosition, type SnapInput } from "../../../../src/qmd/drawing/editor/snap";
import type { DrawingModel } from "../../../../src/qmd/drawing/model";

// Models are plain objects shaped as D2. Scale is px per grid unit, so 8 px is 0.4 units at scale 20.
const SCALE = 20;

const model = (points: Array<{ id: string; x: number; y: number }>, items: unknown[] = []): DrawingModel =>
  ({ v: 1, points: points.map((p) => ({ ...p, dot: true })), items }) as unknown as DrawingModel;

const input = (x: number, y: number, extra: Partial<SnapInput> = {}): SnapInput => ({ x, y, shift: false, alt: false, scale: SCALE, ...extra });

const angleOf = (from: { x: number; y: number }, to: { x: number; y: number }) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

// Axes with the origin at p1 = (10, 10), two grid units per math unit, and y = x^2 drawn on them (item index 1).
// Grid curve: gy = 10 + 2 * ((gx - 10) / 2)^2.
const curveModel = (extraPoints: Array<{ id: string; x: number; y: number }> = []) =>
  model(
    [{ id: "p1", x: 10, y: 10 }, ...extraPoints],
    [
      { k: "axes", id: "a1", o: "p1", x: [-5, 5], y: [-5, 20], sx: 2, sy: 2, ticks: true },
      { k: "fn", axes: "a1", expr: "x^2" },
    ],
  );
const curveY = (gx: number) => 10 + 2 * ((gx - 10) / 2) ** 2;

describe("A5 snapPosition: existing points", () => {
  const m = model([
    { id: "p1", x: 2, y: 3 },
    { id: "p2", x: 2.3, y: 3 },
  ]);

  it("A5 snaps to an existing point within 8 px", () => {
    const r = snapPosition(m, input(1.95, 3.1));
    expect(r.pointId).toBe("p1");
    expect(r.x).toBeCloseTo(2, 5);
    expect(r.y).toBeCloseTo(3, 5);
  });

  it("A5 does not snap to a point farther than 8 px", () => {
    const r = snapPosition(model([{ id: "p1", x: 2, y: 3 }]), input(2.6, 3));
    expect(r.pointId).toBeUndefined();
  });

  it("A5 measures the 8 px threshold with the scale", () => {
    const m1 = model([{ id: "p1", x: 2, y: 3 }]);
    expect(snapPosition(m1, input(2.2, 3.1, { scale: 5 })).pointId).toBe("p1");
    expect(snapPosition(m1, input(2.2, 3.1, { scale: 100 })).pointId).toBeUndefined();
  });

  it("A5 picks the nearest of two points in range", () => {
    expect(snapPosition(m, input(2.25, 3)).pointId).toBe("p2");
  });

  it("A5 skips ignored points", () => {
    const r = snapPosition(m, input(2.02, 3.01), new Set(["p1", "p2"]));
    expect(r.pointId).toBeUndefined();
  });

  it("A5 Alt turns every snap off and returns the input position", () => {
    const r = snapPosition(m, input(2.03, 3.04, { alt: true }));
    expect(r.pointId).toBeUndefined();
    expect(r.curve).toBeUndefined();
    expect(r.x).toBeCloseTo(2.03, 1);
    expect(r.y).toBeCloseTo(3.04, 1);
  });
});

describe("A5 snapPosition: function curves", () => {
  it("A5 snaps to a function curve within 8 px and reports the item and the math x", () => {
    const r = snapPosition(curveModel(), input(12.1, 12.1));
    expect(r.curve?.item).toBe(1);
    expect(Math.abs((r.curve?.x ?? 0) - 1.05)).toBeLessThan(0.15);
    expect(r.pointId).toBeUndefined();
  });

  it("A5 puts the snapped position on the curve", () => {
    const r = snapPosition(curveModel(), input(12.1, 12.1));
    const mathX = r.curve?.x ?? NaN;
    expect(r.x).toBeCloseTo(10 + 2 * mathX, 1);
    expect(r.y).toBeCloseTo(10 + 2 * mathX ** 2, 1);
    expect(r.y).toBeCloseTo(curveY(r.x), 1);
  });

  it("A5 does not snap to a curve farther than 8 px", () => {
    const r = snapPosition(curveModel(), input(12, 14));
    expect(r.curve).toBeUndefined();
  });

  it("A5 prefers an existing point over the curve", () => {
    const r = snapPosition(curveModel([{ id: "p2", x: 12, y: 12 }]), input(12.1, 12.1));
    expect(r.pointId).toBe("p2");
    expect(r.curve).toBeUndefined();
    expect(r.x).toBeCloseTo(12, 5);
    expect(r.y).toBeCloseTo(12, 5);
  });

  it("A5 prefers the curve over the grid", () => {
    // The curve at gx = 12.3 is at gy = 12.645, 0.045 units from the pointer, while the nearest grid node is (12, 13).
    const r = snapPosition(curveModel(), input(12.3, 12.6));
    expect(r.curve?.item).toBe(1);
    expect(r.y).toBeCloseTo(curveY(r.x), 1);
  });

  it("A5 Alt turns curve snapping off", () => {
    const r = snapPosition(curveModel(), input(12.1, 12.1, { alt: true }));
    expect(r.curve).toBeUndefined();
    expect(r.x).toBeCloseTo(12.1, 1);
    expect(r.y).toBeCloseTo(12.1, 1);
  });
});

describe("A5 snapPosition: 15 degrees with Shift", () => {
  const m = model([{ id: "p1", x: 0, y: 0 }]);
  const from = { x: 0, y: 0 };

  it("A5 snaps the direction from `from` to the nearest multiple of 15 degrees with Shift", () => {
    const r = snapPosition(m, input(5, 1.5, { from, shift: true }));
    expect(Math.abs(angleOf(from, r) - 15)).toBeLessThan(0.5);
  });

  it("A5 snaps another direction the same way", () => {
    const r = snapPosition(m, input(5, 3, { from, shift: true }));
    expect(Math.abs(angleOf(from, r) - 30)).toBeLessThan(0.5);
  });

  it("A5 does not snap the angle without Shift", () => {
    const r = snapPosition(m, input(5, 1.5, { from, shift: false }));
    expect(Math.abs(angleOf(from, r) - 15)).toBeGreaterThan(1);
  });

  it("A5 does not snap the angle with Shift but no `from`", () => {
    const r = snapPosition(m, input(5, 1.5, { shift: true }));
    expect(Math.abs(angleOf(from, r) - 15)).toBeGreaterThan(1);
  });

  it("A5 prefers an existing point over the angle", () => {
    const withTarget = model([
      { id: "p1", x: 0, y: 0 },
      { id: "p2", x: 5, y: 1.5 },
    ]);
    const r = snapPosition(withTarget, input(5.1, 1.5, { from, shift: true }), new Set(["p1"]));
    expect(r.pointId).toBe("p2");
    expect(r.x).toBeCloseTo(5, 5);
    expect(r.y).toBeCloseTo(1.5, 5);
  });

  it("A5 Alt disables the angle snap even with Shift", () => {
    const r = snapPosition(m, input(5, 1.5, { from, shift: true, alt: true }), new Set(["p1"]));
    expect(r.x).toBeCloseTo(5, 1);
    expect(r.y).toBeCloseTo(1.5, 1);
  });
});

describe("A5 snapPosition: grid", () => {
  it("A5 snaps to the grid when nothing else applies", () => {
    const r = snapPosition(model([]), input(2.97, 3.03));
    expect(r.x).toBeCloseTo(3, 5);
    expect(r.y).toBeCloseTo(3, 5);
    expect(r.pointId).toBeUndefined();
    expect(r.curve).toBeUndefined();
  });

  it("A5 Alt keeps the free position instead of the grid", () => {
    const r = snapPosition(model([]), input(2.97, 3.03, { alt: true }));
    expect(r.x).toBeCloseTo(2.97, 1);
    expect(r.y).toBeCloseTo(3.03, 1);
  });
});

describe("A5 snapPosition: guides", () => {
  it("A5 reports no guide when no point shares x or y", () => {
    const r = snapPosition(model([{ id: "p1", x: 2, y: 9 }]), input(7.02, 4.03));
    expect(r.guides).toHaveLength(0);
  });

  it("A5 reports a guide for a point sharing y within 4 px after snapping", () => {
    // The position snaps to (7, 5); p1 is at y = 5.1, which is 2 px away at scale 20.
    const r = snapPosition(model([{ id: "p1", x: 2, y: 5.1 }]), input(7.02, 5.03));
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it("A5 reports a guide for a point sharing x within 4 px after snapping", () => {
    const r = snapPosition(model([{ id: "p1", x: 7.1, y: 1 }]), input(7.02, 5.03));
    expect(r.guides.length).toBeGreaterThanOrEqual(1);
  });

  it("A5 reports one guide per alignment", () => {
    const r = snapPosition(
      model([
        { id: "p1", x: 2, y: 9 },
        { id: "p2", x: 7, y: 0 },
      ]),
      input(7.02, 9.03),
    );
    expect(r.guides.length).toBeGreaterThanOrEqual(2);
  });

  it("A5 reports no guide for a point more than 4 px away", () => {
    const r = snapPosition(model([{ id: "p1", x: 2, y: 5.5 }]), input(7.02, 5.03));
    expect(r.guides).toHaveLength(0);
  });

  it("A5 measures the 4 px guide threshold with the scale", () => {
    const m = model([{ id: "p1", x: 2, y: 5.1 }]);
    expect(snapPosition(m, input(7.02, 5.03, { scale: 20 })).guides.length).toBeGreaterThanOrEqual(1);
    expect(snapPosition(m, input(7.02, 5.03, { scale: 100 })).guides).toHaveLength(0);
  });

  it("A5 ignores ignored points when looking for guides", () => {
    const r = snapPosition(model([{ id: "p1", x: 2, y: 5 }]), input(7.02, 5.03), new Set(["p1"]));
    expect(r.guides).toHaveLength(0);
  });
});
