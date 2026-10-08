/** What a user typing or pasting into "add" or "fetch metadata" gets recognised as. */

import { identifiersFromInput } from '@labshelf/core';

describe('identifiersFromInput', () => {
  it('reads a bare arXiv id and strips the version', () => {
    expect(identifiersFromInput('1706.03762')).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
    expect(identifiersFromInput('  1706.03762v5 ')).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
    expect(identifiersFromInput('arXiv:1706.03762')).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
  });

  it('reads a bare DOI and cleans trailing punctuation', () => {
    expect(identifiersFromInput('10.1038/nature12373')).toEqual([{ type: 'doi', value: '10.1038/nature12373' }]);
    expect(identifiersFromInput('10.1038/nature12373,')).toEqual([{ type: 'doi', value: '10.1038/nature12373' }]);
  });

  it('reads a labelled DOI and a doi.org link', () => {
    expect(identifiersFromInput('doi: 10.1038/nature12373')).toEqual([{ type: 'doi', value: '10.1038/nature12373' }]);
    expect(identifiersFromInput('https://doi.org/10.1038/nature12373')).toEqual([
      { type: 'doi', value: '10.1038/nature12373' },
    ]);
  });

  it.each([
    'https://arxiv.org/abs/1706.03762',
    'https://arxiv.org/pdf/1706.03762v7',
    'https://arxiv.org/html/1706.03762',
  ])('reads the arXiv id in %s', (url) => {
    expect(identifiersFromInput(url)).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
  });

  it('reads the PMID in a PubMed URL', () => {
    expect(identifiersFromInput('https://pubmed.ncbi.nlm.nih.gov/12345678/')).toEqual([
      { type: 'pmid', value: '12345678' },
    ]);
    expect(identifiersFromInput('https://www.ncbi.nlm.nih.gov/pubmed/7654321')).toEqual([
      { type: 'pmid', value: '7654321' },
    ]);
  });

  it('finds a DOI inside a publisher link', () => {
    expect(identifiersFromInput('https://onlinelibrary.wiley.com/doi/10.1002/anie.201915678/abstract')).toEqual([
      { type: 'doi', value: '10.1002/anie.201915678' },
    ]);
  });

  it('scans other input like PDF text', () => {
    expect(identifiersFromInput('PMID: 28796665')).toEqual([{ type: 'pmid', value: '28796665' }]);
  });

  it('finds nothing in a title or a plain PDF link', () => {
    expect(identifiersFromInput('hello world')).toEqual([]);
    expect(identifiersFromInput('https://example.org/files/paper.pdf')).toEqual([]);
  });
});
