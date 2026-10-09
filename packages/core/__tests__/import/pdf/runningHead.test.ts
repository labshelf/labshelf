/** Unit tests for inferring the journal from a repeated running head. */

import { journalFromRunningHead } from '@labshelf/core';

describe('journalFromRunningHead', () => {
  it('finds the journal name repeated in the running head', () => {
    const pages = [
      'Journal of Molecular Biology | 3 of 46\nResidue contacts were computed for every frame.',
      'Journal of Molecular Biology | 4 of 46\nThe resulting distributions are shown in Figure 2.',
      '5\nJournal of Molecular Biology\nWe then compared the two folding pathways.',
    ];

    expect(journalFromRunningHead(pages)).toBe('Journal of Molecular Biology');
  });

  it('ignores bare page numbers and lines that are mostly digits', () => {
    const pages = [
      'Page 1\n2018;57(12):3120-3135\nAlpha beta gamma delta',
      'Page 2\n2018;57(12):3120-3135\nEpsilon zeta eta theta',
    ];

    expect(journalFromRunningHead(pages)).toBeUndefined();
  });

  it('returns undefined when no line repeats across pages', () => {
    expect(journalFromRunningHead(['A single page with nothing repeated on it.'])).toBeUndefined();
    expect(journalFromRunningHead([])).toBeUndefined();
  });
});
