/** Contract of arXiv id extraction from URLs, arXiv DOIs and typed ids. */

import { arxivIdFromDoi, arxivIdFromUrl, normalizeArxivId } from '@labshelf/core';

describe('arxivIdFromUrl', () => {
  it.each([
    'https://arxiv.org/abs/1706.03762',
    'https://arxiv.org/pdf/1706.03762v7',
    'https://arxiv.org/html/1706.03762v1',
  ])('reads the id from %s', (url) => {
    expect(arxivIdFromUrl(url)).toBe('1706.03762');
  });

  it('returns undefined for other URLs', () => {
    expect(arxivIdFromUrl('https://example.org/abs/1706.03762')).toBeUndefined();
  });
});

describe('arxivIdFromDoi', () => {
  it('reads the id from an arXiv DOI', () => {
    expect(arxivIdFromDoi('10.48550/arXiv.1706.03762')).toBe('1706.03762');
  });

  it('returns undefined for a publisher DOI or no DOI', () => {
    expect(arxivIdFromDoi('10.1145/1')).toBeUndefined();
    expect(arxivIdFromDoi(undefined)).toBeUndefined();
  });
});

describe('normalizeArxivId', () => {
  it('strips the label and the version', () => {
    expect(normalizeArxivId('arXiv:1706.03762v5')).toBe('1706.03762');
    expect(normalizeArxivId(' 1706.03762 ')).toBe('1706.03762');
  });

  it('rejects text that is not a bare arXiv id', () => {
    expect(normalizeArxivId('hello world')).toBeUndefined();
    expect(normalizeArxivId('10.1038/nature12373')).toBeUndefined();
  });
});
