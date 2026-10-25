/** Contract of PubMed Central id extraction from typed text and article URLs. */

import { normalizePmcid, extractPmcidFromUrl } from '@labshelf/core';

describe('normalizePmcid', () => {
  it.each([
    ['PMC1234567', 'PMC1234567'],
    ['pmc1234567', 'PMC1234567'],
    ['1234567', 'PMC1234567'],
    [' PMC 1234567 ', 'PMC1234567'],
  ])('%s -> %s', (raw, pmcid) => {
    expect(normalizePmcid(raw)).toBe(pmcid);
  });

  it('returns undefined when there are no digits', () => {
    expect(normalizePmcid(undefined)).toBeUndefined();
    expect(normalizePmcid('PMC')).toBeUndefined();
    expect(normalizePmcid('')).toBeUndefined();
  });
});

describe('pmcidFromUrl', () => {
  it.each([
    'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5586528/',
    'https://pmc.ncbi.nlm.nih.gov/articles/PMC5586528/pdf/',
    'https://europepmc.org/articles/PMC5586528',
    'https://europepmc.org/pmc/articles/PMC5586528',
  ])('reads the PMCID in %s', (url) => {
    expect(extractPmcidFromUrl(url)).toBe('PMC5586528');
  });

  it('returns undefined for other URLs', () => {
    expect(extractPmcidFromUrl('https://example.org/articles/PMC5586528')).toBeUndefined();
  });
});
