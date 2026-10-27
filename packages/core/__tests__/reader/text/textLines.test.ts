import {
  detectColumns,
  deriveLinesFromItems,
  deriveReadableItems,
  runOrientation,
  type TextItemBox,
  findCaptionLines,
  pickCaption,
  type TextLine,
} from "../../../src/reader/text/textLines";

function item(str: string, x: number, y: number, width: number, height = 10): TextItemBox {
  return { str, x, y, width, height };
}

describe('deriveLinesFromItems', () => {
  it('groups items that share a baseline into one line, sorted by x regardless of input order', () => {
    // A single short line with too few items to trigger two-column detection.
    const hello = item('Hello', 0, 700, 40);
    const world = item('World', 50, 700, 40); // gap of 10 from `hello`'s end (40): needs a space
    const bang = item('!', 90, 700, 5); // touches `world`'s end (90): no extra space

    const lines = deriveLinesFromItems([bang, hello, world], 600);

    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('Hello World!');
    expect(lines[0]!.x).toBe(0); // leftmost item after sorting
    expect(lines[0]!.xEnd).toBe(95); // rightmost item's x + width after sorting
  });

  it('inserts a space only across a real gap, not between touching items', () => {
    const a = item('foo', 0, 700, 30);
    const bTouching = item('bar', 30, 700, 30); // no gap at all
    const cGap = item('baz', 90, 700, 30); // 30px gap from bTouching's end (60)

    const lines = deriveLinesFromItems([a, bTouching, cGap], 600);
    expect(lines[0]!.text).toBe('foobar baz');
  });

  it('orders lines top-to-bottom (PDF y descending), regardless of input order', () => {
    const top = item('Top', 0, 700, 20);
    const middle = item('Middle', 0, 650, 30);
    const bottom = item('Bottom', 0, 600, 30);

    const lines = deriveLinesFromItems([middle, bottom, top], 600);
    expect(lines.map((l) => l.text)).toEqual(['Top', 'Middle', 'Bottom']);
    expect(lines.map((l) => l.y)).toEqual([700, 650, 600]);
  });
});

/** Builds `count` synthetic word-like items in one visual column, two rows (two lines). */
function columnItems(startX: number, spacing: number, count: number, yTop: number, yBottom: number): TextItemBox[] {
  const perLine = count / 2;
  const items: TextItemBox[] = [];
  for (let i = 0; i < count; i++) {
    const line = i < perLine ? 0 : 1;
    const col = i % perLine;
    items.push(item(`w${i}`, startX + col * spacing, line === 0 ? yTop : yBottom, spacing - 2));
  }
  return items;
}

describe('detectColumns', () => {
  it('returns null when there are too few items', () => {
    const items = [item('a', 0, 700, 10), item('b', 300, 700, 10), item('c', 550, 700, 10)];
    expect(detectColumns(items, 600)).toBeNull();
  });

  it('returns null for a single justified column spanning the full width', () => {
    // Simulate a normal paragraph: overlapping items spread across the whole width,
    // including the middle of the page, so there is no empty gutter to find.
    const items: TextItemBox[] = [];
    for (let i = 0; i < 40; i++) {
      items.push(item(`w${i}`, (i * 17) % 560, 700 - Math.floor(i / 10) * 12, 25));
    }
    expect(detectColumns(items, 600)).toBeNull();
  });

  it('returns null when the mass on the two sides of a gap is too lopsided', () => {
    // A wide left column (25 items) plus a tiny 3-item cluster on the right: there is a
    // clear gap, but the right side is not a real second column.
    const left = columnItems(0, 10, 24, 700, 650); // x in [0, 230]
    const right = columnItems(400, 10, 4, 700, 650); // x in [400, 405]
    expect(detectColumns([...left, ...right], 600)).toBeNull();
  });

  it('finds an x near the gutter for a genuine two-column page', () => {
    const left = columnItems(0, 10, 24, 700, 650); // x in [0, 230]
    const right = columnItems(400, 10, 24, 700, 650); // x in [400, 630]
    const split = detectColumns([...left, ...right], 800);
    expect(split).not.toBeNull();
    expect(split as number).toBeGreaterThan(230);
    expect(split as number).toBeLessThan(400);
  });
});

describe('deriveLinesFromItems with two columns', () => {
  it('reads the whole left column top-to-bottom, then the whole right column, tagging `column`', () => {
    const pageWidth = 600;
    const spacing = 12;
    const wordWidth = 10;

    function row(startX: number, y: number, prefix: string, count: number): TextItemBox[] {
      return Array.from({ length: count }, (_, i) => item(`${prefix}${i}`, startX + i * spacing, y, wordWidth));
    }

    // Left column: x in [0, 118]. Right column: x in [380, 498]. Gutter is comfortably empty.
    const leftLine1 = row(0, 700, 'L1w', 10);
    const leftLine2 = row(0, 650, 'L2w', 10);
    // The right column's first line is visually *above* the left column's lines, to prove
    // that reading order is column-major, not a global sort by y.
    const rightLine1 = row(380, 750, 'R1w', 10);
    const rightLine2 = row(380, 680, 'R2w', 10);

    const shuffled = [...rightLine2, ...leftLine2, ...rightLine1, ...leftLine1];
    const lines = deriveLinesFromItems(shuffled, pageWidth);

    expect(lines).toHaveLength(4);
    expect(lines.map((l) => l.column)).toEqual([0, 0, 1, 1]);
    // Left column lines come first, top-to-bottom, even though the right column has a higher y.
    expect(lines[0]!.y).toBe(700);
    expect(lines[1]!.y).toBe(650);
    expect(lines[2]!.y).toBe(750);
    expect(lines[3]!.y).toBe(680);
    expect(lines[0]!.text.startsWith('L1w0')).toBe(true);
    expect(lines[2]!.text.startsWith('R1w0')).toBe(true);
  });
});

describe('runOrientation', () => {
  it('reads the quarter turn from the pdf.js transform', () => {
    expect(runOrientation([10, 0, 0, 10, 56, 700])).toBe(0);
    // Slight skew of a scan is still upright.
    expect(runOrientation([6.24, -0.02, 0.02, 5.83, 56, 670])).toBe(0);
    expect(runOrientation([0, 9.97, -9.97, 0, 10, 84])).toBe(1);
    expect(runOrientation([-10, 0, 0, -10, 300, 400])).toBe(2);
    expect(runOrientation([0, -10, 10, 0, 600, 700])).toBe(3);
  });
});

describe('deriveReadableItems', () => {
  /** A page of `rows` body lines starting at x=56, one OCR run per word. */
  function bodyPage(rows: number): TextItemBox[] {
    const items: TextItemBox[] = [];
    for (let r = 0; r < rows; r++) {
      for (let w = 0; w < 8; w++) { items.push(item(`word${r}x${w}`, 56 + w * 46, 640 - r * 12, 40, 9)); }
    }
    return items;
  }
  const stamp: TextItemBox = { ...item('Downloaded 12/25/12 to 150.135.135.70. Redistribution subject to license', 10, 84, 552, 10), orientation: 1 };

  it('drops a stamp set sideways up the margin, which would otherwise swallow the line at its y', () => {
    const page = [...bodyPage(6), item('[18]', 56, 87, 16, 8), item('McCreight,', 78, 87, 50, 8), stamp];
    const kept = deriveReadableItems(page, 486);
    expect(kept).not.toContain(stamp);
    const last = deriveLinesFromItems(kept, 486).at(-1)!;
    expect(last.text).toBe('[18] McCreight,');
  });

  it('drops the short tokens OCR strands in the outer margin, so line-anchored tests see the real line start', () => {
    const debris = [item('&', 5, 432, 6, 7), item('5', 5, 416, 5, 7), item('[=', 6, 404, 8, 8), item('ES', 2, 392, 9, 9)];
    const page = [...bodyPage(6), ...debris, item('REFERENCES', 215, 432, 60, 7), item('[1]', 61, 416, 12, 7), item('Author,', 78, 416, 40, 7)];
    const kept = deriveReadableItems(page, 486);
    for (const d of debris) { expect(kept).not.toContain(d); }
    const texts = deriveLinesFromItems(kept, 486).map((l) => l.text);
    expect(texts).toContain('REFERENCES');
    expect(texts).toContain('[1] Author,');
  });

  it('keeps hanging list and reference markers even when the text block starts well to their right', () => {
    const items: TextItemBox[] = [];
    for (let r = 0; r < 9; r++) {
      items.push(item(`${r + 1}.`, 72, 700 - r * 24, 8, 10));
      for (let w = 0; w < 4; w++) { items.push(item(`entry${r}w${w}`, 108 + w * 60, 700 - r * 24, 52, 10)); }
    }
    expect(deriveReadableItems(items, 612)).toHaveLength(items.length);
  });

  it('keeps the text of a page drawn entirely sideways, and everything when there is too little text to find margins', () => {
    const sideways = bodyPage(4).map((it) => ({ ...it, orientation: 1 }));
    expect(deriveReadableItems(sideways, 486)).toHaveLength(sideways.length);
    const sparse = [item('&', 5, 432, 6, 7), item('REFERENCES', 215, 432, 60, 7)];
    expect(deriveReadableItems(sparse, 486)).toEqual(sparse);
  });
});

const W = 612;
const line = (text: string, y: number, over: Partial<TextLine> = {}): TextLine =>
  ({ text, x: 72, xEnd: 540, y, height: 11, column: 0, ...over });

describe('findCaptionLines', () => {
  it('recognises captions by how the line starts', () => {
    const hits = findCaptionLines([
      line('Figure 3. Distribution of values', 700),
      line('FIGURA 1 – Mapa da área de estudo', 650),
      line('Table 2 Summary of the corpus', 600),
      line('Tabela 4: Resultados', 550),
      line('Fig. 12a: Detail', 500),
    ], W, null);
    expect(hits.map((h) => [h.kind, h.label])).toEqual([
      ['figure', '3'], ['figure', '1'], ['table', '2'], ['table', '4'], ['figure', '12a'],
    ]);
  });

  it('reads labels numbered within a section', () => {
    const hits = findCaptionLines([
      line('FIG. 1.1. An example.', 700),
      line('FIG. 3.4. The partitions of vertical segments given in Fig. 1.1(a).', 650),
      line('x = y + z (2.3)', 600, { x: 250, xEnd: 538 }),
    ], W, null);
    expect(hits.map((h) => [h.kind, h.label])).toEqual([['figure', '1.1'], ['figure', '3.4'], ['equation', '2.3']]);
  });

  it('reads a small-caps "FIG." that OCR garbled', () => {
    const hits = findCaptionLines([line('F1G. 2.2. The procedure BFS.', 700), line('Fi1G. 4.1. The procedure COMPUTE_DFMIN.', 650), line('FlG. 3: Detail', 600)], W, null);
    expect(hits.map((h) => [h.kind, h.label])).toEqual([['figure', '2.2'], ['figure', '4.1'], ['figure', '3']]);
  });

  it('ignores a sentence that merely starts a line with the label', () => {
    expect(findCaptionLines([line('Figure 3 shows that the effect', 700), line('Table 2 lists every', 680)], W, null)).toEqual([]);
  });

  it('finds display equations by their number at the right margin', () => {
    const hits = findCaptionLines([
      line('E = mc2 (5)', 700, { x: 250, xEnd: 538 }),
      line('as discussed by the committee in its report of that year (5)', 650, { xEnd: 380 }),
    ], W, null);
    expect(hits).toEqual([{ kind: 'equation', label: '5', lineIndex: 0 }]);
  });
});

describe('pickCaption', () => {
  const hits = [{ kind: 'figure' as const, label: '3' }, { kind: 'table' as const, label: '3' }, { kind: 'figure' as const, label: '4a' }];

  it('matches kind and label, falling back to the label without its sub-figure letter', () => {
    expect(pickCaption(hits, 'table', '3')).toBe(1);
    expect(pickCaption(hits, 'figure', '3b')).toBe(0);
    expect(pickCaption(hits, 'figure', '4')).toBe(2);
    expect(pickCaption(hits, 'equation', '3')).toBe(-1);
  });
});
