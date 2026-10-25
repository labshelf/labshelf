/** Contract of PMID extraction from PubMed URLs. */

import { extractPmidFromUrl } from '@labshelf/core';

describe('pmidFromUrl', () => {
  it('reads the PMID from both PubMed URL forms', () => {
    expect(extractPmidFromUrl('https://pubmed.ncbi.nlm.nih.gov/12345678/')).toBe('12345678');
    expect(extractPmidFromUrl('https://www.ncbi.nlm.nih.gov/pubmed/7654321')).toBe('7654321');
  });

  it('returns undefined for other URLs', () => {
    expect(extractPmidFromUrl('https://example.org/12345678')).toBeUndefined();
  });
});
