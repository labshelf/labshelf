// Tests zoom scale calculations and limits.
import {
  deriveAnchorOrigin,
  deriveBoundedFactor,
  deriveClampedScale,
  formatZoomLabel,
  isPresetScale,
  MAX_SCALE,
  MIN_SCALE,
  deriveNextZoomStep,
  deriveScaleFactor,
} from '../../../src/reader/navigation/scale';

describe('deriveClampedScale', () => {
  it('clamps below the minimum and above the maximum', () => {
    expect(deriveClampedScale(0.1)).toBe(MIN_SCALE);
    expect(deriveClampedScale(10)).toBe(MAX_SCALE);
  });

  it('leaves an in-range value untouched', () => {
    expect(deriveClampedScale(1.5)).toBe(1.5);
  });

  it('falls back to 1 for non-finite input', () => {
    expect(deriveClampedScale(NaN)).toBe(1);
    expect(deriveClampedScale(Infinity)).toBe(1);
    expect(deriveClampedScale(-Infinity)).toBe(1);
  });
});

describe('isPresetScale', () => {
  it('accepts every pdf.js preset value', () => {
    expect(isPresetScale('page-width')).toBe(true);
    expect(isPresetScale('page-fit')).toBe(true);
    expect(isPresetScale('page-actual')).toBe(true);
    expect(isPresetScale('auto')).toBe(true);
  });

  it('rejects a numeric scale string and nullish values', () => {
    expect(isPresetScale('1.5')).toBe(false);
    expect(isPresetScale(null)).toBe(false);
    expect(isPresetScale(undefined)).toBe(false);
  });
});

describe('deriveNextZoomStep', () => {
  it('finds the neighbouring step from an in-between value', () => {
    expect(deriveNextZoomStep(0.6, 1)).toBe(0.67);
    expect(deriveNextZoomStep(0.6, -1)).toBe(0.5);
  });

  it('finds the neighbouring step from a value that is exactly on the ladder', () => {
    expect(deriveNextZoomStep(1, 1)).toBe(1.1);
    expect(deriveNextZoomStep(1, -1)).toBe(0.9);
  });

  it('clamps at both ends of the ladder', () => {
    expect(deriveNextZoomStep(MAX_SCALE, 1)).toBe(MAX_SCALE);
    expect(deriveNextZoomStep(MIN_SCALE, -1)).toBe(MIN_SCALE);
  });
});

describe('deriveScaleFactor', () => {
  it('returns 1 for a zero or non-finite delta', () => {
    expect(deriveScaleFactor(0, 0)).toBe(1);
    expect(deriveScaleFactor(NaN, 0)).toBe(1);
  });

  it('maps small pixel deltas smoothly and symmetrically', () => {
    const down = deriveScaleFactor(10, 0);
    const up = deriveScaleFactor(-10, 0);
    expect(down).toBeLessThan(1);
    expect(up).toBeGreaterThan(1);
    // exp(-x) and exp(x) are reciprocals, so the pair roughly cancels out.
    expect(down * up).toBeCloseTo(1, 5);
  });

  it('maps a big pixel delta (>= 50) to a 1.1x notch', () => {
    const factor = deriveScaleFactor(100, 0);
    expect(factor).toBeCloseTo(1 / 1.1, 5);
  });

  it('maps line-mode deltas to 1.1x notches regardless of magnitude', () => {
    expect(deriveScaleFactor(3, 1)).toBeCloseTo(1 / 1.1, 5);
    expect(deriveScaleFactor(-3, 1)).toBeCloseTo(1.1, 5);
  });

  it('always returns a factor within [0.5, 2]', () => {
    expect(deriveScaleFactor(300, 1)).toBe(0.5);
    expect(deriveScaleFactor(-300, 1)).toBe(2);
  });
});

describe('deriveBoundedFactor', () => {
  it('never lets current * factor leave [0.25, 8]', () => {
    const grow = deriveBoundedFactor(7, 2);
    expect(7 * grow).toBeCloseTo(MAX_SCALE, 5);

    const shrink = deriveBoundedFactor(0.3, 0.5);
    expect(0.3 * shrink).toBeCloseTo(MIN_SCALE, 5);
  });

  it('returns 1 when already pinned at a bound', () => {
    expect(deriveBoundedFactor(MAX_SCALE, 2)).toBe(1);
    expect(deriveBoundedFactor(MIN_SCALE, 0.5)).toBe(1);
  });

  it('returns 1 when current is zero or negative', () => {
    expect(deriveBoundedFactor(0, 2)).toBe(1);
    expect(deriveBoundedFactor(-5, 2)).toBe(1);
  });
});

describe('deriveAnchorOrigin', () => {
  it('rebases client coordinates by the container rect and adds the container offset', () => {
    // A 220px sidebar pushes the viewer container's bounding rect to the right.
    const containerRect = { left: 220, top: 0 };
    const containerOffset = { left: 0, top: 0 };
    expect(deriveAnchorOrigin(420, 100, containerRect, containerOffset)).toEqual([200, 100]);
  });

  it('adds a non-zero offsetParent offset on top of the rect subtraction', () => {
    const containerRect = { left: 220, top: 50 };
    const containerOffset = { left: 5, top: 10 };
    expect(deriveAnchorOrigin(300, 150, containerRect, containerOffset)).toEqual([300 - 220 + 5, 150 - 50 + 10]);
  });
});

describe('formatZoomLabel', () => {
  it('formats a scale as a rounded percentage', () => {
    expect(formatZoomLabel(1)).toBe('100%');
    expect(formatZoomLabel(1.5)).toBe('150%');
    expect(formatZoomLabel(0.333)).toBe('33%');
  });

  it('clamps out-of-range or invalid scales before formatting', () => {
    expect(formatZoomLabel(NaN)).toBe('100%');
    expect(formatZoomLabel(100)).toBe('800%');
  });
});
