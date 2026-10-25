// Tests splitting reference entries.
import * as fs from 'fs';
import * as path from 'path';
import { splitReferenceEntries } from '../../../src/reader/text/referenceSplit';
import type { TextLine } from '../../../src/reader/text/textLines';

function loadFixture(name: string): TextLine[] {
  const filePath = path.join(__dirname, '../fixtures/references', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TextLine[];
}

function line(text: string, y = 800, extra: Partial<TextLine> = {}): TextLine {
  return { text, x: 50, xEnd: 50 + text.length * 6, y, height: 12, column: 0, ...extra };
}

describe('splitReferenceEntries', () => {
  it('splits bracket-numbered entries, parses their number, and joins continuations', () => {
    const lines = loadFixture('numeric-bracket.json');
    const entries = splitReferenceEntries(lines);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(entries[0]!.text).toBe(
      '[1] Smith, J., & Doe, A. (2019). A great paper on testing methodologies. Journal of Software, 12(3), 45-67.',
    );
  });

  it('drops junk lines that precede the first marker', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-bracket.json'));
    // The fixture's first line is a lone page number ("12") before the "[1]" marker.
    expect(entries[0]!.text.startsWith('[1]')).toBe(true);
    expect(entries.some((e) => e.text.trim() === '12')).toBe(false);
  });

  it('de-hyphenates a trailing hyphen followed by a lowercase continuation', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-bracket.json'));
    expect(entries[1]!.text).toBe(
      '[2] Lee, K. (2020). Another important contribution to the field of international research. Proceedings of XYZ, 5(1), 10-20.',
    );
  });

  it('splits dot-numbered entries and parses their number', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-dot.json'));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
  });

  it('joins a continuation line with a plain space when there is no hyphenation', () => {
    const entries = splitReferenceEntries(loadFixture('numeric-dot.json'));
    expect(entries[0]!.text).toBe('1. Alpha, B. (2018). Foundations of testing. Computing Reviews, 4(2), 88-99.');
  });

  it('splits an unnumbered hanging-indent list on the left edge', () => {
    const entries = splitReferenceEntries(loadFixture('hanging-indent.json'));
    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.number === null)).toBe(true);
    expect(entries[0]!.text).toBe('Smith, J. (2020). A study of testing. Journal of Software Engineering, 12(3), 45-67.');
    expect(entries[1]!.text).toBe(
      'Doe, A., & Lee, K. (2019). Verification techniques for large-scale systems. Proceedings of ICSE.',
    );
    expect(entries[2]!.text).toBe('Nguyen, T. (2021). A concise note on formal methods.');
  });

  it('splits a two-column numbered list in reading order, keeping each column tag', () => {
    const entries = splitReferenceEntries(loadFixture('two-column.json'));
    expect(entries).toHaveLength(6);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(entries.map((e) => e.column)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('returns [] for an empty input', () => {
    expect(splitReferenceEntries([])).toEqual([]);
  });

  it('returns [] for a block with no markers and no indentation', () => {
    const lines = [line('Plain paragraph text one.'), line('Plain paragraph text two.'), line('Plain paragraph text three.')];
    expect(splitReferenceEntries(lines)).toEqual([]);
  });
});

describe('splitReferenceEntries on scans and OCR output', () => {
  const split = splitReferenceEntries;
  const ln = (text: string, y: number, x = 72) => ({ text, x, xEnd: 540, y, height: 10, column: 0 });

  it('splits numbered lists whose markers OCR damaged', () => {
    const entries = split([ln('[l] A. Author. First title.', 700), ln('Journal, 2019.', 688), ln('[2) B. Writer. Second.', 670), ln('(3] C. Third. 2021.', 650)]);
    expect(entries.map((e) => e.number)).toEqual([1, 2, 3]);
    expect(entries[0]!.text).toBe('[l] A. Author. First title. Journal, 2019.');
  });

  it('reads a closing bracket OCR turned into "1" only when the list\'s own numbering confirms it', () => {
    const entries = split([ln('[6] H. Edelsbrunner, A time- and space-optimal solution.', 700), ln('[71 ———, Dynamic data structures, Report 59.', 688),
      ln('Technische Universitat Graz, 1980.', 676), ln('[8] H. Edelsbrunner and J. van Leeuwen.', 664)]);
    expect(entries.map((e) => e.number)).toEqual([6, 7, 8]);
    expect(entries[1]!.text).toBe('[7] ———, Dynamic data structures, Report 59. Technische Universitat Graz, 1980.');

    // "[71" after [3] is not the next entry: it stays a continuation line of [3].
    const other = split([ln('[3] A. Author. Title.', 700), ln('[71 stray fragment', 688), ln('[4] B. Writer. Second.', 676)]);
    expect(other.map((e) => e.number)).toEqual([3, 4]);
  });

  it('splits block-style lists (ABNT: flush left, separated by vertical space)', () => {
    const entries = split([
      ln('SILVA, A. B.; COSTA, R. Título do primeiro trabalho.', 700), ln('Revista X, v. 12, n. 3, p. 45-67, 2020.', 688),
      ln('SOUZA, M. Outro trabalho relevante. São Paulo:', 664), ln('Editora Y, 2019.', 652),
      ln('TANAKA, K. Terceiro. Rio de Janeiro: Z, 2021.', 628),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries[1]!.text).toBe('SOUZA, M. Outro trabalho relevante. São Paulo: Editora Y, 2019.');
  });

  it('falls back to author-like line starts when spacing is uniform', () => {
    const entries = split([
      ln('Silva, A. B. First work. Journal A, 2020.', 700), ln('Souza, M. Second work that is long enough to', 688),
      ln('wrap onto another line. Journal B, 2019.', 676), ln('Tanaka, K. Third work. Journal C, 2021.', 664),
    ]);
    expect(entries.map((e) => e.text.split(',')[0])).toEqual(['Silva', 'Souza', 'Tanaka']);
  });
});
