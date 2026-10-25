/** What a user typing or pasting into "add" or "fetch metadata" gets recognised as. */

import { extractIdentifiersFromInput } from '@labshelf/core';

describe('identifiersFromInput', () => {
  it('reads a bare arXiv id and strips the version', () => {
    expect(extractIdentifiersFromInput('1706.03762')).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
    expect(extractIdentifiersFromInput('  1706.03762v5 ')).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
    expect(extractIdentifiersFromInput('arXiv:1706.03762')).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
  });

  it('reads an old-style arXiv id, bare or in a link', () => {
    expect(extractIdentifiersFromInput('hep-th/9711200')).toEqual([{ type: 'arxiv', value: 'hep-th/9711200' }]);
    expect(extractIdentifiersFromInput('https://arxiv.org/abs/math.GT/0309136v2')).toEqual([{ type: 'arxiv', value: 'math.GT/0309136' }]);
    expect(extractIdentifiersFromInput('10.48550/arXiv.hep-th/9711200')).toEqual([{ type: 'doi', value: '10.48550/arXiv.hep-th/9711200' }]);
  });

  it('reads a bare DOI and cleans trailing punctuation', () => {
    expect(extractIdentifiersFromInput('10.1038/nature12373')).toEqual([{ type: 'doi', value: '10.1038/nature12373' }]);
    expect(extractIdentifiersFromInput('10.1038/nature12373,')).toEqual([{ type: 'doi', value: '10.1038/nature12373' }]);
  });

  it('reads a labelled DOI and a doi.org link', () => {
    expect(extractIdentifiersFromInput('doi: 10.1038/nature12373')).toEqual([{ type: 'doi', value: '10.1038/nature12373' }]);
    expect(extractIdentifiersFromInput('https://doi.org/10.1038/nature12373')).toEqual([
      { type: 'doi', value: '10.1038/nature12373' },
    ]);
  });

  it.each([
    'https://arxiv.org/abs/1706.03762',
    'https://arxiv.org/pdf/1706.03762v7',
    'https://arxiv.org/html/1706.03762',
  ])('reads the arXiv id in %s', (url) => {
    expect(extractIdentifiersFromInput(url)).toEqual([{ type: 'arxiv', value: '1706.03762' }]);
  });

  it('reads the PMID in a PubMed URL', () => {
    expect(extractIdentifiersFromInput('https://pubmed.ncbi.nlm.nih.gov/12345678/')).toEqual([
      { type: 'pmid', value: '12345678' },
    ]);
    expect(extractIdentifiersFromInput('https://www.ncbi.nlm.nih.gov/pubmed/7654321')).toEqual([
      { type: 'pmid', value: '7654321' },
    ]);
  });

  it('finds a DOI inside a publisher link', () => {
    expect(extractIdentifiersFromInput('https://onlinelibrary.wiley.com/doi/10.1002/anie.201915678/abstract')).toEqual([
      { type: 'doi', value: '10.1002/anie.201915678' },
    ]);
  });

  it('scans other input like PDF text', () => {
    expect(extractIdentifiersFromInput('PMID: 28796665')).toEqual([{ type: 'pmid', value: '28796665' }]);
  });

  it('finds nothing in a title or a plain PDF link', () => {
    expect(extractIdentifiersFromInput('hello world')).toEqual([]);
    expect(extractIdentifiersFromInput('https://example.org/files/paper.pdf')).toEqual([]);
  });
});
