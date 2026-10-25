/** Contract of arXiv id extraction from URLs, arXiv DOIs and typed ids. */

import { extractArxivIdentifierFromDoi, extractArxivIdentifierFromUrl, normalizeArxivIdentifier } from '@labshelf/core';

describe('arxivIdFromUrl', () => {
  it.each([
    'https://arxiv.org/abs/1706.03762',
    'https://arxiv.org/pdf/1706.03762v7',
    'https://arxiv.org/html/1706.03762v1',
    'https://doi.org/10.48550/arXiv.1706.03762',
  ])('reads the id from %s', (url) => {
    expect(extractArxivIdentifierFromUrl(url)).toBe('1706.03762');
  });

  it('returns undefined for other URLs', () => {
    expect(extractArxivIdentifierFromUrl('https://example.org/abs/1706.03762')).toBeUndefined();
  });

  it.each([
    ['https://arxiv.org/abs/hep-th/9711200', 'hep-th/9711200'],
    ['https://arxiv.org/pdf/hep-th/9711200v3', 'hep-th/9711200'],
    ['https://arxiv.org/abs/math.GT/0309136', 'math.GT/0309136'],
    ['https://arxiv.org/html/cond-mat/0501001v2', 'cond-mat/0501001'],
  ])('reads the old-style id in %s', (url, id) => {
    expect(extractArxivIdentifierFromUrl(url)).toBe(id);
  });
});

describe('arxivIdFromDoi', () => {
  it('reads the id from an arXiv DOI', () => {
    expect(extractArxivIdentifierFromDoi('10.48550/arXiv.1706.03762')).toBe('1706.03762');
  });

  it('reads an old-style id from an arXiv DOI', () => {
    expect(extractArxivIdentifierFromDoi('10.48550/arXiv.hep-th/9711200')).toBe('hep-th/9711200');
    expect(extractArxivIdentifierFromDoi('10.48550/arXiv.math.GT/0309136v2')).toBe('math.GT/0309136');
  });

  it('returns undefined for a publisher DOI or no DOI', () => {
    expect(extractArxivIdentifierFromDoi('10.1145/1')).toBeUndefined();
    expect(extractArxivIdentifierFromDoi(undefined)).toBeUndefined();
  });
});

describe('normalizeArxivId', () => {
  it('strips the label and the version', () => {
    expect(normalizeArxivIdentifier('arXiv:1706.03762v5')).toBe('1706.03762');
    expect(normalizeArxivIdentifier(' 1706.03762 ')).toBe('1706.03762');
  });

  it('accepts old-style ids, with or without label and version', () => {
    expect(normalizeArxivIdentifier('hep-th/9711200')).toBe('hep-th/9711200');
    expect(normalizeArxivIdentifier('arXiv:math.GT/0309136v4')).toBe('math.GT/0309136');
  });

  it('rejects text that is not a bare arXiv id', () => {
    expect(normalizeArxivIdentifier('hello world')).toBeUndefined();
    expect(normalizeArxivIdentifier('10.1038/nature12373')).toBeUndefined();
  });
});
