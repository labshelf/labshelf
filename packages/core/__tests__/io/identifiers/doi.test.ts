/** Contract of DOI extraction and cleanup, whatever source the candidate came from. */

import { cleanDoiCandidate, doiVariants, extractDoi } from '@labshelf/core';

describe('extractDoi', () => {
  it.each([
    ['https://doi.org/10.1016/0196-6774(82)90007-4', '10.1016/0196-6774(82)90007-4'],
    ['(doi:10.1145/10515.10546).', '10.1145/10515.10546'],
    ['https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf', '10.1007/s10107-023-01234-5'],
    ['https://onlinelibrary.wiley.com/doi/10.1002/anie.201915678/abstract', '10.1002/anie.201915678'],
    ['https://epubs.siam.org/doi/pdf/10.1137/S0895479802410815?download=true', '10.1137/S0895479802410815'],
    ['https://www.example.org/doi/10.1000%2Fxyz123', '10.1000/xyz123'],
    ['https://example.org/article#10.1000/frag', '10.1000/frag'],
    ['doi:10.1016/j.x.2020(1).', '10.1016/j.x.2020(1)'],
    ['10.1038/nature12373,', '10.1038/nature12373'],
  ])('%s -> %s', (input, doi) => {
    expect(extractDoi(input)).toBe(doi);
  });

  it('returns undefined when there is no DOI', () => {
    expect(extractDoi('https://www.sciencedirect.com/science/article/pii/0196677482900074')).toBeUndefined();
    expect(extractDoi(undefined)).toBeUndefined();
    expect(extractDoi('10.1000/abstract')).toBeUndefined();
  });
});

describe('cleanDoiCandidate', () => {
  it('decodes escapes and drops query and fragment', () => {
    expect(cleanDoiCandidate('10.1000%2Fxyz?download=true#top')).toBe('10.1000/xyz');
  });

  it('strips repeated publisher tails', () => {
    expect(cleanDoiCandidate('10.1002/anie.1/full/pdf')).toBe('10.1002/anie.1');
  });

  it('keeps balanced brackets and drops unbalanced closers', () => {
    expect(cleanDoiCandidate('10.1016/j.x.2020(1).')).toBe('10.1016/j.x.2020(1)');
    expect(cleanDoiCandidate('10.1145/10515.10546)')).toBe('10.1145/10515.10546');
  });

  it('returns undefined when the tail strip leaves no DOI', () => {
    expect(cleanDoiCandidate('10.1000/pdf')).toBeUndefined();
  });
});

describe('doiVariants', () => {
  it('expands a component DOI into itself and its parent article DOI', () => {
    expect(doiVariants('10.7554/eLife.28383.001')).toEqual([
      '10.7554/eLife.28383.001',
      '10.7554/eLife.28383',
    ]);
  });

  it('returns only the DOI itself when there is no numeric component suffix', () => {
    expect(doiVariants('10.1038/nature12373')).toEqual(['10.1038/nature12373']);
  });
});
