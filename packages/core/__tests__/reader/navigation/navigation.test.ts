import {
  CROSS_SOURCE_WINDOW_MS,
  isDuplicateDelivery,
  type ActionStamp,
  FIND_ORIGIN_TTL_MS,
  FIND_OVERLAY_PX,
  deriveMatchScroll,
  deriveFreshOrigin,
  HISTORY_CAP,
  HistoryStack,
  type ViewPosition,
  deriveAnchorOrigin,
  deriveBoundedFactor,
  deriveClampedScale,
  formatZoomLabel,
  isPresetScale,
  MAX_SCALE,
  MIN_SCALE,
  deriveNextZoomStep,
  deriveScaleFactor,
} from "../../../src/reader/navigation/navigation";

const stamp = (action: string, source: 'key' | 'host', at: number): ActionStamp => ({ action, source, at });

describe('actionDedupe', () => {
  it('runs the first delivery', () => {
    expect(isDuplicateDelivery(null, stamp('zoomIn', 'key', 0))).toBe(false);
  });

  it('drops the same chord arriving through the other route shortly after', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomIn', 'host', 1030))).toBe(true);
    expect(isDuplicateDelivery(stamp('find', 'host', 1000), stamp('find', 'key', 1005))).toBe(true);
  });

  it('keeps repeats from the same source, so a held key still repeats', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomIn', 'key', 1030))).toBe(false);
    expect(isDuplicateDelivery(stamp('zoomIn', 'host', 1000), stamp('zoomIn', 'host', 1030))).toBe(false);
  });

  it('keeps a different action from the other route', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomOut', 'host', 1010))).toBe(false);
  });

  it('keeps the other route once the window has passed', () => {
    expect(isDuplicateDelivery(stamp('zoomIn', 'key', 1000), stamp('zoomIn', 'host', 1000 + CROSS_SOURCE_WINDOW_MS))).toBe(false);
  });

  it('handles a held chord delivered through both routes: one action per key event', () => {
    // Key events every 40 ms, each echoed by the host 25 ms later.
    let last: ActionStamp | null = null;
    let ran = 0;
    const deliver = (s: ActionStamp): void => {
      if (isDuplicateDelivery(last, s)) { return; }
      last = s;
      ran++;
    };
    for (let i = 0; i < 5; i++) {
      deliver(stamp('zoomIn', 'key', i * 40));
      deliver(stamp('zoomIn', 'host', i * 40 + 25));
    }
    expect(ran).toBe(5);
  });
});

describe('findScroll', () => {
  describe('deriveMatchScroll', () => {
    const viewH = 900;

    it('stays put when the hit was already in the reading zone', () => {
      expect(deriveMatchScroll({ top: 400, bottom: 420 }, viewH)).toEqual({ kind: 'stay' });
      expect(deriveMatchScroll({ top: FIND_OVERLAY_PX, bottom: FIND_OVERLAY_PX + 20 }, viewH)).toEqual({ kind: 'stay' });
    });

    it('re-places a hit hidden under the overlay toolbar and find bar', () => {
      const decision = deriveMatchScroll({ top: 50, bottom: 70 }, viewH);
      expect(decision).toEqual({ kind: 'place', top: 270 });
    });

    it('re-places a hit above, below or too close to the bottom edge of the view', () => {
      expect(deriveMatchScroll({ top: -300, bottom: -280 }, viewH).kind).toBe('place');
      expect(deriveMatchScroll({ top: 1500, bottom: 1520 }, viewH).kind).toBe('place');
      expect(deriveMatchScroll({ top: 860, bottom: 880 }, viewH).kind).toBe('place');
    });

    it('places at 30% of the view, but never under the overlay in a short panel', () => {
      expect(deriveMatchScroll(null, 1000)).toEqual({ kind: 'place', top: 300 });
      expect(deriveMatchScroll(null, 200)).toEqual({ kind: 'place', top: FIND_OVERLAY_PX });
    });

    it('never stays without a known starting position', () => {
      expect(deriveMatchScroll(null, viewH).kind).toBe('place');
    });
  });

  describe('deriveFreshOrigin', () => {
    const origin = { top: 1200, left: 0, at: 10_000 };

    it('keeps an origin recorded moments ago', () => {
      expect(deriveFreshOrigin(origin, 10_000)).toBe(origin);
      expect(deriveFreshOrigin(origin, 10_000 + FIND_ORIGIN_TTL_MS)).toBe(origin);
    });

    it('drops a stale origin so a late text-layer render cannot yank the reader back', () => {
      expect(deriveFreshOrigin(origin, 10_001 + FIND_ORIGIN_TTL_MS)).toBeNull();
    });

    it('passes null through', () => {
      expect(deriveFreshOrigin(null, 5)).toBeNull();
    });
  });
});

function loc(pageNumber: number, top = 0): ViewPosition {
  return { pageNumber, top };
}

describe('HistoryStack', () => {
  describe('visit / back / forward', () => {
    it('is lossless on a simple round trip', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1));

      const backTarget = stack.back(loc(2));
      expect(backTarget).toEqual(loc(1));

      const forwardTarget = stack.forward(loc(1));
      expect(forwardTarget).toEqual(loc(2));

      // The stack is back to the state right after the initial visit.
      expect(stack.canGoBack).toBe(true);
      expect(stack.canGoForward).toBe(false);
    });

    it('discards the forward branch on a new visit', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1));
      stack.back(loc(2));
      expect(stack.canGoForward).toBe(true);

      stack.visit(loc(1));
      expect(stack.canGoForward).toBe(false);
    });
  });

  describe('visit deduplication', () => {
    it('drops a near-duplicate consecutive visit but keeps a different page or a far offset', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1, 100));
      stack.visit(loc(1, 150)); // same page, |delta| = 50 < 120: deduped against the last entry
      expect(stack.back(loc(1, 150))).toEqual(loc(1, 100));
      expect(stack.canGoBack).toBe(false);

      stack.visit(loc(1, 100));
      stack.visit(loc(1, 300)); // same page, |delta| = 200 >= 120: kept
      stack.visit(loc(2, 100)); // different page: kept regardless of offset

      expect(stack.back(loc(99))).toEqual(loc(2, 100));
      expect(stack.back(loc(2, 100))).toEqual(loc(1, 300));
      expect(stack.back(loc(1, 300))).toEqual(loc(1, 100));
      expect(stack.canGoBack).toBe(false);
    });
  });

  describe('cap', () => {
    it(`keeps at most ${HISTORY_CAP} entries, dropping the oldest`, () => {
      const stack = new HistoryStack();
      for (let page = 1; page <= HISTORY_CAP + 1; page++) {
        stack.visit(loc(page));
      }

      const popped: ViewPosition[] = [];
      let current = loc(9999);
      while (stack.canGoBack) {
        const target = stack.back(current);
        if (!target) { break; }
        popped.push(target);
        current = target;
      }

      expect(popped).toHaveLength(HISTORY_CAP);
      // The very first visit (page 1) was evicted; the most recent (HISTORY_CAP + 1) pops first.
      expect(popped[0]).toEqual(loc(HISTORY_CAP + 1));
      expect(popped.some((p) => p.pageNumber === 1)).toBe(false);
      expect(popped[popped.length - 1]).toEqual(loc(2));
    });
  });

  describe('canGoBack / canGoForward', () => {
    it('reflect the current stack contents', () => {
      const stack = new HistoryStack();
      expect(stack.canGoBack).toBe(false);
      expect(stack.canGoForward).toBe(false);

      stack.visit(loc(1));
      expect(stack.canGoBack).toBe(true);

      stack.back(loc(2));
      expect(stack.canGoBack).toBe(false);
      expect(stack.canGoForward).toBe(true);
    });
  });

  describe('back / forward on an empty stack', () => {
    it('return null and do not mutate the other stack', () => {
      const stack = new HistoryStack();
      expect(stack.back(loc(1))).toBeNull();
      expect(stack.canGoForward).toBe(false);

      expect(stack.forward(loc(1))).toBeNull();
      expect(stack.canGoBack).toBe(false);
    });
  });

  describe('clear', () => {
    it('empties both stacks', () => {
      const stack = new HistoryStack();
      stack.visit(loc(1));
      stack.back(loc(2));
      expect(stack.canGoBack || stack.canGoForward).toBe(true);

      stack.clear();
      expect(stack.canGoBack).toBe(false);
      expect(stack.canGoForward).toBe(false);
    });
  });
});

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
