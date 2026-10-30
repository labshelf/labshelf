import { findFloatCaptionNear } from "../../src/reader/destTarget";
import { deriveFloatRegion, deriveCropRectForPreview, deriveDestPoint, type PdfRegion } from "../../src/reader/geometry";
import type { TextLine } from "../../src/reader/textLines";

const W = 612;
const H = 792;
const line = (text: string, y: number, over: Partial<TextLine> = {}): TextLine =>
  ({ text, x: 72, xEnd: 540, y, height: 11, column: 0, ...over });
const body = (fromY: number, count: number): TextLine[] =>
  Array.from({ length: count }, (_, i) => line('Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod', fromY - i * 15));

describe('deriveFloatRegion', () => {
  it('takes the text-free band above a caption that sits below its figure', () => {
    const lines = [...body(760, 6), line('Figure 1: A figure standing above its caption.', 430), ...body(400, 10)];
    const hit = { kind: 'figure' as const, label: '1', lineIndex: 6 };
    const region = deriveFloatRegion(lines, hit, W, H, null);
    // from just under the caption up to the last body line above the figure (y 685)
    expect(region.yBottom).toBeLessThan(430);
    expect(region.yTop).toBeGreaterThan(640);
    expect(region.yTop).toBeLessThanOrEqual(685 + 1);
    expect([region.x0, region.x1]).toEqual([0, W]);
  });

  it('takes the band below when the caption sits above its figure (ABNT)', () => {
    const lines = [...body(760, 6), line('Figura 2 – Titulo acima da figura', 670), ...body(400, 10)];
    const region = deriveFloatRegion(lines, { kind: 'figure', label: '2', lineIndex: 6 }, W, H, null);
    expect(region.yTop).toBeGreaterThanOrEqual(670);
    expect(region.yBottom).toBeLessThan(450);
    expect(region.yBottom).toBeGreaterThanOrEqual(400);
  });

  it('does not let axis labels OCR found inside the figure end the band', () => {
    const lines = [
      ...body(760, 4),
      line('0.5', 600, { x: 100, xEnd: 118 }),
      line('Time (s)', 480, { x: 280, xEnd: 330 }),
      line('Figure 1: caption below the plot', 430),
      ...body(400, 8),
    ];
    const region = deriveFloatRegion(lines, { kind: 'figure', label: '1', lineIndex: 6 }, W, H, null);
    expect(region.yTop).toBeGreaterThan(640);
  });

  it('always looks below a table caption', () => {
    const lines = [...body(760, 3), line('Table 1. Results', 700), line('a  1  2  3', 680), line('b  4  5  6', 665)];
    const region = deriveFloatRegion(lines, { kind: 'table', label: '1', lineIndex: 3 }, W, H, null);
    expect(region.yTop).toBeGreaterThanOrEqual(700);
    expect(region.yBottom).toBeLessThan(665);
  });

  it('ends a table at the first clear break instead of showing the void under it', () => {
    const rows = [line('Table 1. Results', 700), line('Group  Mean  SD', 682), line('A  12.4  1.2', 666), line('B  15.8  2.1', 650)];
    // table at the foot of the page: nothing below the last row
    const alone = deriveFloatRegion(rows, { kind: 'table', label: '1', lineIndex: 0 }, W, H, null);
    expect(alone.yBottom).toBeLessThan(650);
    expect(alone.yBottom).toBeGreaterThan(615);
    // table followed, after a gap, by the next paragraph: the paragraph is left out
    const followed = deriveFloatRegion([...rows, ...body(590, 6)], { kind: 'table', label: '1', lineIndex: 0 }, W, H, null);
    expect(followed.yBottom).toBeLessThan(650);
    expect(followed.yBottom).toBeGreaterThan(600);
  });

  it('keeps the fixed band under a table caption when OCR recognised nothing in the table', () => {
    const region = deriveFloatRegion([line('Tabela 3 – Imagem', 700)], { kind: 'table', label: '3', lineIndex: 0 }, W, H, null);
    expect(region.yBottom).toBeCloseTo(700 + 11 - H * 0.4, 0);
  });

  it('crops to the caption\'s column on a two-column page and spans both when the caption straddles the gutter', () => {
    const left = line('Figure 1. In the left column', 430, { x: 50, xEnd: 290 });
    const wide = line('Figure 2. Across both columns of the page', 430, { x: 120, xEnd: 500 });
    expect(deriveFloatRegion([left], { kind: 'figure', label: '1', lineIndex: 0 }, W, H, 306)).toMatchObject({ x0: 0, x1: 306 });
    expect(deriveFloatRegion([wide], { kind: 'figure', label: '2', lineIndex: 0 }, W, H, 306)).toMatchObject({ x0: 0, x1: W });
  });

  it('shows a symmetric band when no clear float neighbours the caption', () => {
    const lines = [...body(760, 20), line('Figure 9. Squeezed between paragraphs', 445), ...body(430, 20)];
    const region = deriveFloatRegion(lines, { kind: 'figure', label: '9', lineIndex: 20 }, W, H, null);
    expect(region.yTop - region.yBottom).toBeGreaterThan(H * 0.3);
    expect(region.yTop).toBeGreaterThan(445);
    expect(region.yBottom).toBeLessThan(445);
  });

  it('pads a band around an equation and stays inside the page', () => {
    const region = deriveFloatRegion([line('x = y (1)', 20, { x: 250, xEnd: 538 })], { kind: 'equation', label: '1', lineIndex: 0 }, W, H, null);
    expect(region.yBottom).toBe(0);
    expect(region.yTop).toBeGreaterThan(31);
  });
});

describe('deriveDestPoint', () => {
  it('reads x/y from an XYZ destination', () => {
    expect(deriveDestPoint([{ num: 1 }, { name: 'XYZ' }, 100, 200, 1.5])).toEqual({ kind: 'XYZ', x: 100, y: 200 });
  });

  it('reads only y from FitH/FitBH', () => {
    expect(deriveDestPoint([{ num: 1 }, { name: 'FitH' }, 300])).toEqual({ kind: 'FitH', x: null, y: 300 });
    expect(deriveDestPoint([{ num: 1 }, { name: 'FitBH' }, 300])).toEqual({ kind: 'FitBH', x: null, y: 300 });
  });

  it('reads only x from FitV/FitBV', () => {
    expect(deriveDestPoint([{ num: 1 }, { name: 'FitV' }, 150])).toEqual({ kind: 'FitV', x: 150, y: null });
    expect(deriveDestPoint([{ num: 1 }, { name: 'FitBV' }, 150])).toEqual({ kind: 'FitBV', x: 150, y: null });
  });

  it('reads x from index 2 (left) and y from index 5 (top) for FitR', () => {
    // [pageRef, {name}, left, bottom, right, top]
    expect(deriveDestPoint([{ num: 1 }, { name: 'FitR' }, 10, 20, 300, 400])).toEqual({ kind: 'FitR', x: 10, y: 400 });
  });

  it('reads neither coordinate for Fit/FitB', () => {
    expect(deriveDestPoint([{ num: 1 }, { name: 'Fit' }])).toEqual({ kind: 'Fit', x: null, y: null });
    expect(deriveDestPoint([{ num: 1 }, { name: 'FitB' }])).toEqual({ kind: 'FitB', x: null, y: null });
  });

  it('preserves an explicit null coordinate as null', () => {
    expect(deriveDestPoint([{ num: 1 }, { name: 'XYZ' }, null, 500, 0])).toEqual({ kind: 'XYZ', x: null, y: 500 });
  });

  it('returns null for malformed input', () => {
    expect(deriveDestPoint('XYZ')).toBeNull(); // not an array
    expect(deriveDestPoint(null)).toBeNull();
    expect(deriveDestPoint(undefined)).toBeNull();
    expect(deriveDestPoint([{ num: 1 }])).toBeNull(); // too short (length < 2)
    expect(deriveDestPoint([{ num: 1 }, {}])).toBeNull(); // mode object missing `name`
    expect(deriveDestPoint([{ num: 1 }, 'XYZ'])).toBeNull(); // mode is not an object
    expect(deriveDestPoint([{ num: 1 }, { name: 'Bogus' }, 1, 2])).toBeNull(); // unknown kind
  });
});

describe('deriveCropRectForPreview', () => {
  const pageWidth = 600;
  const pageHeight = 1000;

  it('always spans the full page width', () => {
    const rect = deriveCropRectForPreview(500, pageWidth, pageHeight);
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(pageWidth);
  });

  it('defaults to 38% of the page height', () => {
    const rect = deriveCropRectForPreview(500, pageWidth, pageHeight);
    expect(rect.height).toBe(380);
  });

  it('keeps a lead margin above the anchor', () => {
    // 4% of 1000 = 40px of lead above the anchor y.
    const rect = deriveCropRectForPreview(500, pageWidth, pageHeight);
    expect(rect.y).toBe(460);
  });

  it('clamps at the top of the page', () => {
    const rect = deriveCropRectForPreview(10, pageWidth, pageHeight);
    expect(rect.y).toBe(0);
  });

  it('clamps at the bottom of the page', () => {
    const rect = deriveCropRectForPreview(990, pageWidth, pageHeight);
    expect(rect.y + rect.height).toBe(pageHeight);
    expect(rect.y).toBe(pageHeight - 380);
  });

  it('defaults to the top of the page when the anchor is null', () => {
    const rect = deriveCropRectForPreview(null, pageWidth, pageHeight);
    expect(rect.y).toBe(0);
  });
});

// Regression: hover previews on real page geometry, lines extracted with pdf.js the way PageTextCache does.
const PAGE = { width: 612, height: 792, columnSplit: null };
const at = (y: number, x: number, xEnd: number, text: string, height = 12): TextLine => ({ text, x, xEnd, y, height, column: 0 });
const contains = (r: PdfRegion, l: TextLine): boolean => r.yTop >= l.y + 0.7 * l.height && r.yBottom <= l.y;
const excludesBelow = (r: PdfRegion, l: TextLine): boolean => l.y + 0.7 * l.height <= r.yBottom;

describe('figure preview of a hyperref figure link (Mnih et al. 2013, "Playing Atari", page 7)', () => {
  // Figure 2 is four plots ABOVE its caption; their small-font tick labels and axis titles are extracted as text and
  // the four panels' labels on one baseline join into page-wide lines. Figure 3's graphic and caption follow below.
  const lines = [
    at(704.8, 134.8, 481.9, 'Average Reward on Breakout Average Reward on Seaquest Average Q on Breakout Average Q on Seaquest', 4),
    at(702.0, 114.1, 419.8, '250 1800 4 9', 4),
    at(696.3, 211.5, 419.8, '1600 3.5 8', 4),
    at(691.8, 114.1, 419.8, '200 1400 7', 4),
    at(689.3, 317.9, 320.2, '3', 4),
    at(685.0, 211.5, 419.8, '1200 6', 4),
    at(681.6, 114.1, 320.2, '150 2.5', 4),
    at(679.4, 211.5, 419.8, '1000 5', 4),
    at(676.5, 317.9, 320.2, '2', 4),
    at(673.7, 213.8, 419.8, '800 4', 4),
    at(671.4, 114.1, 320.2, '100 1.5', 4),
    at(668.0, 213.8, 419.8, '600 3', 4),
    at(662.4, 213.8, 419.8, '400 1 2', 4),
    at(661.3, 116.4, 120.9, '50', 4),
    at(656.7, 213.8, 419.8, '200 0.5 1', 4),
    at(651.1, 118.6, 419.8, '0 0 0 0', 4),
    at(647.5, 122.0, 503.1, '0 10 20 30 40 50 60 70 80 90 100 0 10 20 30 40 50 60 70 80 90 100 0 10 20 30 40 50 60 70 80 90 100', 4),
    at(643.5, 146.7, 474.9, 'Training Epochs Training Epochs Training Epochs Training Epochs', 4),
    at(610.3, 108.0, 504.0, 'Figure 2: The two plots on the left show average reward per episode on Breakout and Seaquest', 10),
    at(599.4, 108.0, 504.0, 'respectively during training. The statistics were computed by running an ε-greedy policy with ε =', 10),
    at(588.4, 108.0, 504.0, '0.05 for 10000 steps. The two plots on the right show the average maximum predicted action-value', 10),
    at(577.5, 108.0, 504.0, 'of a held out set of states on Breakout and Seaquest respectively. One epoch corresponds to 50000', 10),
    at(566.5, 108.0, 368.1, 'minibatch weight updates or roughly 30 minutes of training time.', 10),
    at(463.0, 108.0, 504.0, 'Figure 3: The leftmost plot shows the predicted value function for a 30 frame segment of the game', 10),
    at(452.0, 108.0, 482.2, 'Seaquest. The three screenshots correspond to the frames labeled by A, B, and C respectively.', 10),
  ];

  it('1.3a shows the whole figure above its caption, not the space below the caption', () => {
    // Link "figure.2": XYZ dest at y = 642.228, just under the plots.
    const hit = findFloatCaptionNear(lines, PAGE, { floatKind: 'figure', label: '2' }, { x: 108, y: 642.228 });
    expect(hit).not.toBeNull();
    expect(lines[hit!.lineIndex]!.text).toMatch(/^Figure 2:/);
    const region = deriveFloatRegion(lines, hit!, PAGE.width, PAGE.height, PAGE.columnSplit);
    // The plot titles at the top of the figure and the whole caption are inside; Figure 3's caption is not.
    expect(contains(region, lines[0]!)).toBe(true);
    expect(contains(region, lines[22]!)).toBe(true);
    expect(excludesBelow(region, lines[23]!)).toBe(true);
  });

  it('A2 covers the four plot titles, the plots and the caption of Figure 2', () => {
    const hit = findFloatCaptionNear(lines, PAGE, { floatKind: 'figure', label: '2' }, { x: 108, y: 642.228 });
    expect(hit).not.toBeNull();
    const region = deriveFloatRegion(lines, hit!, PAGE.width, PAGE.height, PAGE.columnSplit);
    expect(contains(region, lines[0]!)).toBe(true); // plot titles
    expect(contains(region, lines[17]!)).toBe(true); // x-axis titles
    for (const i of [18, 19, 20, 21, 22]) { expect(contains(region, lines[i]!)).toBe(true); }
  });
});

describe('deriveFloatRegion with full-height body text above a figure', () => {
  it('1.3b still bounds the band at the body text when small-font labels sit inside the figure', () => {
    const lines = [
      ...body(760, 4),
      line('0 10 20 30 40', 600, { x: 100, xEnd: 500, height: 4 }),
      line('Time Time', 480, { x: 100, xEnd: 500, height: 4 }),
      line('Figure 1: caption below the plot', 430, { height: 11 }),
      ...body(400, 8),
    ];
    const region = deriveFloatRegion(lines, { kind: 'figure', label: '1', lineIndex: 6 }, W, H, null);
    // last body line above the figure is at y 715
    expect(region.yTop).toBeLessThanOrEqual(715 + 1);
    expect(region.yTop).toBeGreaterThan(640);
    expect(region.yBottom).toBeLessThan(430);
  });
});
