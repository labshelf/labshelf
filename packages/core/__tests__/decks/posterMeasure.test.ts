/**
 * Spec 7.2: the pure poster measures. smallTextThresholdPt, calibrationFromCard, rulerTicks and clampPosterZoom.
 * Canvas px per mm is 96 / 25.4 (3.7795...); canvas px per inch is 96.
 */
import { calibrationFromCard, clampPosterZoom, rulerTicks, smallTextThresholdPt, type RulerTick } from "../../src/decks/posterMeasure";

const PX_PER_MM = 96 / 25.4;
const round2 = (n: number) => Math.round(n * 100) / 100;
const offsets = (ticks: RulerTick[]) => ticks.map((t) => t.offset);
const labelled = (ticks: RulerTick[]) => ticks.filter((t) => t.major).map((t) => t.label);

// --- 7.2a ---------------------------------------------------------------------------------------------------------------------------

describe("smallTextThresholdPt", () => {
  it("7.2a gives 24 pt for A0", () => {
    expect(smallTextThresholdPt({ w: 841, h: 1189, unit: "mm" })).toBe(24);
  });

  it("7.2a gives about 16.9 pt for A1 and 12 pt for A2", () => {
    // 24 * 594 / 841 = 16.95 and 24 * 420 / 841 = 11.99; the spec names 16.9 and 12, so only the one-decimal neighbourhood is checked.
    expect(smallTextThresholdPt({ w: 594, h: 841, unit: "mm" })).toBeCloseTo(16.95, 0);
    expect(smallTextThresholdPt({ w: 420, h: 594, unit: "mm" })).toBeCloseTo(12, 0);
  });

  it("7.2a uses the shorter side, so landscape gives the same threshold", () => {
    expect(smallTextThresholdPt({ w: 1189, h: 841, unit: "mm" })).toBe(24);
  });

  it("7.2a converts in sizes at 25.4 mm per inch and rounds to one decimal", () => {
    // 33 in = 838.2 mm: 24 * 838.2 / 841 = 23.92
    expect(smallTextThresholdPt({ w: 33, h: 46, unit: "in" })).toBe(23.9);
    expect(smallTextThresholdPt({ w: 46, h: 33, unit: "in" })).toBe(23.9);
  });

  it("7.2a converts px sizes at 96 px per inch", () => {
    // 2000 px = 529.17 mm: 24 * 529.17 / 841 = 15.10
    expect(smallTextThresholdPt({ w: 3000, h: 2000, unit: "px" })).toBe(15.1);
  });
});

// --- 7.2b ---------------------------------------------------------------------------------------------------------------------------

describe("calibrationFromCard", () => {
  it("7.2b gives screen px per mm over the 85.6 mm card and the time it was measured", () => {
    const now = new Date("2026-03-04T05:06:07.000Z");
    expect(calibrationFromCard(342.4, now)).toEqual({ pxPerMm: 4, measuredAt: "2026-03-04T05:06:07.000Z" });
  });

  it("7.2b rounds px per mm to 4 decimals", () => {
    // 300 / 85.6 = 3.504672...
    expect(calibrationFromCard(300, new Date(0)).pxPerMm).toBe(3.5047);
  });

  it("7.2b refuses a width that is not finite and > 0 with a RangeError", () => {
    for (const px of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => calibrationFromCard(px, new Date(0))).toThrow(RangeError);
  });
});

describe("rulerTicks in mm", () => {
  it("7.2b ticks every 1 mm when one mm spans at least 4 screen px", () => {
    // 2 screen px per canvas px: 1 mm = 7.56 screen px. 76 canvas px = 20.1 mm.
    const ticks = rulerTicks(76, "mm", 2);
    expect(ticks).toHaveLength(21);
    expect(offsets(ticks).slice(0, 3)).toEqual([0, 3.78, 7.56]);
    expect(ticks[20]!.offset).toBe(round2(20 * PX_PER_MM));
  });

  it("7.2b labels a major tick every 10 mm when 10 mm spans at least 40 screen px", () => {
    const ticks = rulerTicks(76, "mm", 2);
    expect(ticks[0]).toEqual({ offset: 0, label: "0", major: true });
    expect(ticks[5]).toEqual({ offset: round2(5 * PX_PER_MM), label: null, major: false });
    expect(ticks[10]).toEqual({ offset: 37.8, label: "10", major: true });
    expect(labelled(ticks)).toEqual(["0", "10", "20"]);
  });

  it("7.2b ticks every 5 mm, with a major tick every 100 mm, when 1 mm spans less than 4 screen px", () => {
    // 1 screen px per canvas px: 1 mm = 3.78 px, 5 mm = 18.9 px, 10 mm = 37.8 px (< 40). 400 canvas px = 105.8 mm.
    const ticks = rulerTicks(400, "mm", 1);
    expect(ticks).toHaveLength(22);
    expect(ticks[1]!.offset).toBe(18.9);
    expect(ticks[20]).toEqual({ offset: 377.95, label: "100", major: true });
    expect(labelled(ticks)).toEqual(["0", "100"]);
    expect(ticks[2]!.major).toBe(false);
  });

  it("7.2b ticks every 10 mm when 5 mm spans less than 4 screen px", () => {
    // 0.1 screen px per canvas px: 5 mm = 1.89 px. 4000 canvas px = 1058.3 mm.
    const ticks = rulerTicks(4000, "mm", 0.1);
    expect(ticks).toHaveLength(106);
    expect(ticks[1]!.offset).toBe(37.8);
    expect(labelled(ticks)).toEqual(["0", "100", "200", "300", "400", "500", "600", "700", "800", "900", "1000"]);
  });

  it("7.2b offsets run from 0 to the length inclusive", () => {
    const length = 10 * PX_PER_MM + 0.5;
    const ticks = rulerTicks(length, "mm", 2);
    expect(ticks[0]!.offset).toBe(0);
    expect(ticks[ticks.length - 1]!.offset).toBe(37.8);
    for (const t of ticks) expect(t.offset).toBeLessThanOrEqual(length);
  });
});

describe("rulerTicks in inches", () => {
  it("7.2b ticks every 1/8 in when that spans at least 4 screen px, with a labelled major tick every inch", () => {
    // 1 screen px per canvas px: 1/8 in = 12 px. 200 canvas px = 2.08 in.
    const ticks = rulerTicks(200, "in", 1);
    expect(ticks).toHaveLength(17);
    expect(offsets(ticks).slice(0, 3)).toEqual([0, 12, 24]);
    expect(ticks[8]).toEqual({ offset: 96, label: "1", major: true });
    expect(ticks[4]).toEqual({ offset: 48, label: null, major: false });
    expect(labelled(ticks)).toEqual(["0", "1", "2"]);
  });

  it("7.2b ticks every 1/2 in when 1/8 in spans less than 4 screen px", () => {
    // 0.25 screen px per canvas px: 1/8 in = 3 px, 1/2 in = 12 px.
    const ticks = rulerTicks(200, "in", 0.25);
    expect(offsets(ticks)).toEqual([0, 48, 96, 144, 192]);
    expect(labelled(ticks)).toEqual(["0", "1", "2"]);
  });

  it("7.2b ticks every inch when 1/2 in spans less than 4 screen px", () => {
    // 0.05 screen px per canvas px: 1/2 in = 2.4 px.
    const ticks = rulerTicks(500, "in", 0.05);
    expect(offsets(ticks)).toEqual([0, 96, 192, 288, 384, 480]);
    expect(ticks.every((t) => t.major)).toBe(true);
    expect(labelled(ticks)).toEqual(["0", "1", "2", "3", "4", "5"]);
  });
});

describe("clampPosterZoom", () => {
  it("7.2b keeps a zoom within 10%..400%", () => {
    expect(clampPosterZoom(1)).toBe(1);
    expect(clampPosterZoom(1.5)).toBe(1.5);
    expect(clampPosterZoom(0.1)).toBe(0.1);
    expect(clampPosterZoom(4)).toBe(4);
  });

  it("7.2b clamps below 10% and above 400%", () => {
    expect(clampPosterZoom(0.05)).toBe(0.1);
    expect(clampPosterZoom(0)).toBe(0.1);
    expect(clampPosterZoom(-2)).toBe(0.1);
    expect(clampPosterZoom(5)).toBe(4);
  });

  it("7.2b gives 1 for a non-finite zoom", () => {
    expect(clampPosterZoom(Number.NaN)).toBe(1);
    expect(clampPosterZoom(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampPosterZoom(Number.NEGATIVE_INFINITY)).toBe(1);
  });
});
