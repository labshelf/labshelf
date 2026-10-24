// Tests reference list parsing and lookups.
import * as fs from 'fs';
import * as path from 'path';
import {
  entryAtY,
  entryByNumber,
  findReferencesStart,
  isReferencesHeading,
  matchAuthorYear,
} from '../../../src/reader/text/referenceList';
import { splitReferenceEntries } from '../../../src/reader/text/referenceSplit';
import type { TextLine } from '../../../src/reader/text/textLines';

function loadFixture(name: string): TextLine[] {
  const filePath = path.join(__dirname, '../fixtures/references', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TextLine[];
}

function line(text: string, y = 800, extra: Partial<TextLine> = {}): TextLine {
  return { text, x: 50, xEnd: 50 + text.length * 6, y, height: 12, column: 0, ...extra };
}

describe('findReferencesStart', () => {
  it('matches a plain "References" heading', () => {
    expect(findReferencesStart([line('Introduction'), line('References'), line('[1] Smith.')])).toBe(1);
  });

  it('matches an upper-case "REFERENCES" heading', () => {
    expect(findReferencesStart([line('REFERENCES')])).toBe(0);
  });

  it('matches a numbered heading like "7. References"', () => {
    expect(findReferencesStart([line('Conclusion'), line('7. References')])).toBe(1);
  });

  it('matches "Bibliography"', () => {
    expect(findReferencesStart([line('Bibliography')])).toBe(0);
  });

  it('matches "Works Cited"', () => {
    expect(findReferencesStart([line('Works Cited')])).toBe(0);
  });

  it('rejects a long sentence that merely contains the word', () => {
    const lines = [
      line('This section references several prior results and earlier bibliography entries in detail.'),
    ];
    expect(findReferencesStart(lines)).toBe(-1);
  });

  it('returns -1 when no heading is present', () => {
    expect(findReferencesStart([line('Introduction'), line('Method'), line('Results')])).toBe(-1);
  });
});

describe('entryAtY', () => {
  const entries = splitReferenceEntries(loadFixture('two-column.json'));

  it('picks the entry whose first baseline is nearest at/below the destination y', () => {
    const entry = entryAtY(entries, { y: 706 });
    expect(entry?.number).toBe(5);
  });

  it('tolerates a destination a couple of points inside the first line', () => {
    const entry = entryAtY(entries, { y: 704 });
    expect(entry?.number).toBe(5);
  });

  it('returns null when the nearest entry is more than 4 line-heights away', () => {
    expect(entryAtY(entries, { y: 2000 })).toBeNull();
  });

  it('prefers the entry in the destination column when columnSplit and x are given', () => {
    // Without column info, entry #3 (col 0, y 740) is nearest to y=738.
    expect(entryAtY(entries, { y: 738 })?.number).toBe(3);
    // With x on the right side of the gutter, entry #4 (col 1, y 736) is preferred instead.
    expect(entryAtY(entries, { y: 738, x: 450, columnSplit: 345 })?.number).toBe(4);
  });
});

describe('entryByNumber', () => {
  const entries = splitReferenceEntries(loadFixture('two-column.json'));

  it('returns the entry with the matching number', () => {
    expect(entryByNumber(entries, 4)?.text).toContain('Davis');
  });

  it('returns null when no entry has that number', () => {
    expect(entryByNumber(entries, 99)).toBeNull();
  });
});

describe('reference list in scans and non-English papers', () => {
  const split = splitReferenceEntries;
  const ln = (text: string, y: number, x = 72) => ({ text, x, xEnd: 540, y, height: 10, column: 0 });

  it('recognises the heading across languages, accents lost to OCR, numbering and letter-spacing', () => {
    for (const h of ['REFERÊNCIAS', 'REFERENCIAS', 'Referências Bibliográficas', '7. References', 'VI REFERENCES', 'Bibliografia',
      'R E F E R E N C E S', 'Literaturverzeichnis', 'Références bibliographiques', 'References:']) {
      expect(isReferencesHeading(h)).toBe(true);
    }
    for (const h of ['References to earlier work are scarce in this field of study', 'Reference values', 'Introduction']) {
      expect(isReferencesHeading(h)).toBe(false);
    }
  });

  describe('matchAuthorYear', () => {
    const entries = split([
      ln('SILVA, A. B.; COSTA, R. Primeiro. Revista X, 2020.', 700),
      ln('SILVA, A. B. Segundo, sozinho. Revista Y, 2020.', 676),
      ln('SOUZA, M. Um estudo sobre Silva. Editora, 2019a.', 652),
      ln('SOUZA, M. Outro estudo. Editora, 2019b.', 628),
      ln('MÜLLER, H. Arbeit. Verlag, 2018.', 604),
    ]);

    it('matches surname in the author area plus year, ignoring case and accents', () => {
      expect(matchAuthorYear(entries, { surname: 'Muller', years: ['2018'] }).map((e) => e.text)).toEqual(['MÜLLER, H. Arbeit. Verlag, 2018.']);
    });

    it('uses co-authors to disambiguate', () => {
      const hits = matchAuthorYear(entries, { surname: 'Silva', coauthors: ['Costa'], years: ['2020'] });
      expect(hits).toHaveLength(1);
      expect(hits[0]!.text).toContain('Primeiro');
    });

    it('returns every candidate when the citation itself is ambiguous', () => {
      expect(matchAuthorYear(entries, { surname: 'Silva', years: ['2020'] })).toHaveLength(2);
      expect(matchAuthorYear(entries, { surname: 'Souza', years: ['2019'] })).toHaveLength(2);
      expect(matchAuthorYear(entries, { surname: 'Souza', years: ['2019b'] }).map((e) => e.text)).toEqual(['SOUZA, M. Outro estudo. Editora, 2019b.']);
    });

    it('does not match a surname that only appears in a title, a wrong year, or a partial word', () => {
      expect(matchAuthorYear(entries, { surname: 'Silva', years: ['2019'] })).toEqual([]);
      expect(matchAuthorYear(entries, { surname: 'Sou', years: ['2019'] })).toEqual([]);
      expect(matchAuthorYear(entries, { surname: 'Tanaka', years: ['2020'] })).toEqual([]);
    });
  });
});
