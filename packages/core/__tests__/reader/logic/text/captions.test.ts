// Tests caption and figure label detection.
import { findCaptionLines, pickCaption } from '../../../../src/reader/logic/text/captions';
import type { TextLine } from '../../../../src/reader/logic/text/textLines';

const W = 612;
const H = 792;
const line = (text: string, y: number, over: Partial<TextLine> = {}): TextLine =>
  ({ text, x: 72, xEnd: 540, y, height: 11, column: 0, ...over });
const body = (fromY: number, count: number): TextLine[] =>
  Array.from({ length: count }, (_, i) => line('Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod', fromY - i * 15));

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
