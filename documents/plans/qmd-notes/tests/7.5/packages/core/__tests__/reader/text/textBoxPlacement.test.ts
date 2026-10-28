import { fitEmptyBox, snapBox } from "../../../src/reader/text/textBoxPlacement";
import type { PageRect } from "../../../src/reader/text/textBoxPlacement";

const EPS = 1e-9;
const right = (r: PageRect): number => r.x + r.w;
const bottom = (r: PageRect): number => r.y + r.h;
const overlaps = (a: PageRect, b: PageRect): boolean =>
  a.x < right(b) - EPS && right(a) > b.x + EPS && a.y < bottom(b) - EPS && bottom(a) > b.y + EPS;
const contains = (r: PageRect, p: { x: number; y: number }): boolean =>
  p.x >= r.x - EPS && p.x <= right(r) + EPS && p.y >= r.y - EPS && p.y <= bottom(r) + EPS;
const inPage = (r: PageRect): boolean =>
  r.x >= -EPS && r.y >= -EPS && right(r) <= 1 + EPS && bottom(r) <= 1 + EPS;
const fourDecimals = (n: number): boolean => Math.round(n * 1e4) / 1e4 === n;

describe('fitEmptyBox', () => {
  it('7.5a caps a box in an empty column at 0.4 by 0.25', () => {
    const box = fitEmptyBox({ x: 0.5, y: 0.5 }, []);
    expect(box).not.toBeNull();
    expect(box!.w).toBeCloseTo(0.4, 4);
    expect(box!.h).toBeCloseTo(0.25, 4);
    expect(contains(box!, { x: 0.5, y: 0.5 })).toBe(true);
    expect(inPage(box!)).toBe(true);
  });

  it('7.5a ignores text that is far from the point when capping the box', () => {
    const far: PageRect[] = [{ x: 0.05, y: 0.02, w: 0.9, h: 0.05 }, { x: 0.05, y: 0.93, w: 0.9, h: 0.05 }];
    const box = fitEmptyBox({ x: 0.5, y: 0.5 }, far);
    expect(box).not.toBeNull();
    expect(box!.w).toBeCloseTo(0.4, 4);
    expect(box!.h).toBeCloseTo(0.25, 4);
    for (const r of far) expect(overlaps(box!, r)).toBe(false);
  });

  it('7.5b fits the box into the gap between two paragraphs', () => {
    const rects: PageRect[] = [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
      { x: 0.1, y: 0.5, w: 0.8, h: 0.3 },
    ];
    const point = { x: 0.5, y: 0.45 };
    const box = fitEmptyBox(point, rects);
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0.4 - 1e-4);
    expect(bottom(box!)).toBeLessThanOrEqual(0.5 + 1e-4);
    expect(box!.h).toBeCloseTo(0.1, 3);
    expect(box!.w).toBeCloseTo(0.4, 4);
    expect(contains(box!, point)).toBe(true);
    for (const r of rects) expect(overlaps(box!, r)).toBe(false);
  });

  it('7.5b rounds every fraction of the box to 4 decimals', () => {
    const rects: PageRect[] = [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.2333333 },
      { x: 0.1, y: 0.4123457, w: 0.8, h: 0.3 },
    ];
    const box = fitEmptyBox({ x: 0.3333333, y: 0.3777777 }, rects);
    expect(box).not.toBeNull();
    for (const n of [box!.x, box!.y, box!.w, box!.h]) expect(fourDecimals(n)).toBe(true);
  });

  it('7.5b stays beside text when the point sits in a column next to a paragraph', () => {
    const rects: PageRect[] = [{ x: 0.1, y: 0.1, w: 0.35, h: 0.8 }];
    const point = { x: 0.7, y: 0.5 };
    const box = fitEmptyBox(point, rects);
    expect(box).not.toBeNull();
    expect(overlaps(box!, rects[0])).toBe(false);
    expect(contains(box!, point)).toBe(true);
    expect(box!.w).toBeCloseTo(0.4, 4);
    expect(box!.h).toBeCloseTo(0.25, 4);
  });

  it('7.5e returns null when the gap is shorter than 0.03', () => {
    const rects: PageRect[] = [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
      { x: 0.1, y: 0.42, w: 0.8, h: 0.3 },
    ];
    expect(fitEmptyBox({ x: 0.5, y: 0.41 }, rects)).toBeNull();
  });

  it('7.5e returns null when the gap is narrower than 0.05', () => {
    const rects: PageRect[] = [
      { x: 0.05, y: 0.05, w: 0.4, h: 0.9 },
      { x: 0.48, y: 0.05, w: 0.47, h: 0.9 },
    ];
    expect(fitEmptyBox({ x: 0.465, y: 0.5 }, rects)).toBeNull();
  });

  it('7.5e returns a box when the gap is just above the minimum height', () => {
    const rects: PageRect[] = [
      { x: 0.1, y: 0.1, w: 0.8, h: 0.3 },
      { x: 0.1, y: 0.44, w: 0.8, h: 0.3 },
    ];
    const box = fitEmptyBox({ x: 0.5, y: 0.42 }, rects);
    expect(box).not.toBeNull();
    expect(box!.h).toBeCloseTo(0.04, 3);
    expect(box!.w).toBeGreaterThanOrEqual(0.05);
  });

  it('7.5e returns null when the point lies on text', () => {
    const rects: PageRect[] = [{ x: 0.1, y: 0.1, w: 0.8, h: 0.8 }];
    expect(fitEmptyBox({ x: 0.5, y: 0.5 }, rects)).toBeNull();
  });
});

describe('snapBox', () => {
  it('7.5c shrinks a rect off text on the side with the smallest overlap (right edge)', () => {
    const text: PageRect = { x: 0.55, y: 0.05, w: 0.25, h: 0.4 };
    const out = snapBox({ x: 0.2, y: 0.2, w: 0.4, h: 0.2 }, [text]);
    expect(overlaps(out, text)).toBe(false);
    expect(out.x).toBeCloseTo(0.2, 4);
    expect(out.y).toBeCloseTo(0.2, 4);
    expect(out.h).toBeCloseTo(0.2, 4);
    expect(right(out)).toBeCloseTo(0.55, 4);
  });

  it('7.5c shrinks a rect off text on the side with the smallest overlap (bottom edge)', () => {
    const text: PageRect = { x: 0.1, y: 0.35, w: 0.8, h: 0.3 };
    const out = snapBox({ x: 0.2, y: 0.2, w: 0.4, h: 0.2 }, [text]);
    expect(overlaps(out, text)).toBe(false);
    expect(out.x).toBeCloseTo(0.2, 4);
    expect(out.y).toBeCloseTo(0.2, 4);
    expect(out.w).toBeCloseTo(0.4, 4);
    expect(bottom(out)).toBeCloseTo(0.35, 4);
  });

  it('7.5c shrinks a rect off text on the side with the smallest overlap (left edge)', () => {
    const text: PageRect = { x: 0.05, y: 0.05, w: 0.2, h: 0.5 };
    const out = snapBox({ x: 0.2, y: 0.2, w: 0.4, h: 0.2 }, [text]);
    expect(overlaps(out, text)).toBe(false);
    expect(out.x).toBeCloseTo(0.25, 4);
    expect(right(out)).toBeCloseTo(0.6, 4);
    expect(out.y).toBeCloseTo(0.2, 4);
    expect(out.h).toBeCloseTo(0.2, 4);
  });

  it('7.5c leaves a rect that touches no text and is far from every edge unchanged', () => {
    const rect: PageRect = { x: 0.2, y: 0.2, w: 0.3, h: 0.2 };
    const text: PageRect = { x: 0.6, y: 0.6, w: 0.2, h: 0.2 };
    expect(snapBox(rect, [text])).toEqual(rect);
  });

  it('7.5d snaps a left edge within 0.01 of the page margin', () => {
    const out = snapBox({ x: 0.005, y: 0.3, w: 0.2, h: 0.2 }, []);
    expect(out.x).toBeCloseTo(0, 4);
  });

  it('7.5d snaps a right edge within 0.01 of the page margin', () => {
    const out = snapBox({ x: 0.7, y: 0.3, w: 0.295, h: 0.2 }, []);
    expect(right(out)).toBeCloseTo(1, 4);
  });

  it('7.5d snaps top and bottom edges within 0.01 of the page margins', () => {
    const top = snapBox({ x: 0.3, y: 0.008, w: 0.2, h: 0.2 }, []);
    expect(top.y).toBeCloseTo(0, 4);
    const low = snapBox({ x: 0.3, y: 0.7, w: 0.2, h: 0.293 }, []);
    expect(bottom(low)).toBeCloseTo(1, 4);
  });

  it('7.5d snaps a bottom edge within 0.01 of the top of a text rect', () => {
    const text: PageRect = { x: 0.5, y: 0.6, w: 0.3, h: 0.2 };
    const out = snapBox({ x: 0.2, y: 0.3, w: 0.2, h: 0.295 }, [text]);
    expect(bottom(out)).toBeCloseTo(0.6, 4);
  });

  it('7.5d snaps a left edge within 0.01 of the right edge of a text rect', () => {
    const text: PageRect = { x: 0.3, y: 0.6, w: 0.5, h: 0.2 };
    const out = snapBox({ x: 0.805, y: 0.55, w: 0.1, h: 0.2 }, [text]);
    expect(out.x).toBeCloseTo(0.8, 4);
  });

  it('7.5d does not snap edges farther than 0.01 from the margin', () => {
    const out = snapBox({ x: 0.03, y: 0.3, w: 0.2, h: 0.2 }, []);
    expect(out.x).toBeCloseTo(0.03, 4);
    expect(out.y).toBeCloseTo(0.3, 4);
    expect(out.w).toBeCloseTo(0.2, 4);
    expect(out.h).toBeCloseTo(0.2, 4);
  });

  it('7.5d does not snap edges farther than 0.01 from a text edge', () => {
    const text: PageRect = { x: 0.5, y: 0.6, w: 0.3, h: 0.2 };
    const out = snapBox({ x: 0.2, y: 0.3, w: 0.2, h: 0.28 }, [text]);
    expect(bottom(out)).toBeCloseTo(0.58, 4);
  });

  it('7.5d rounds every fraction of the result to 4 decimals', () => {
    const text: PageRect = { x: 0.55, y: 0.05, w: 0.25, h: 0.4 };
    const out = snapBox({ x: 0.2111111, y: 0.2222222, w: 0.4333333, h: 0.2444444 }, [text]);
    for (const n of [out.x, out.y, out.w, out.h]) expect(fourDecimals(n)).toBe(true);
  });
});
