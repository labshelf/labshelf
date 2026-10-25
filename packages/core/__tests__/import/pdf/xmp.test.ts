/** Unit tests for reading bibliographic fields out of an XMP packet. */

import { extractMetadataFromXmp } from '@labshelf/core';

describe('metadataFromXmp', () => {
  it('maps a publisher XMP packet onto bibliographic fields', () => {
    const xmp = {
      getAll: () => ({
        'dc:title': 'A stillbirth calculator',
        'dc:creator': 'Amanda S. Trudell; Methodius G. Tuuli',
        'prism:publicationName': 'PLOS ONE',
        'prism:volume': '12',
        'prism:number': '3',
        'prism:startingPage': 'e0173461',
        'prism:doi': '10.1371/journal.pone.0173461',
        'prism:issn': '1932-6203',
        'prism:coverDate': '2017-03-08',
        'dc:language': 'en',
      }),
    };

    expect(extractMetadataFromXmp(xmp)).toMatchObject({
      title: 'A stillbirth calculator',
      authors: ['Amanda S. Trudell', 'Methodius G. Tuuli'],
      journal: 'PLOS ONE',
      volume: '12',
      issue: '3',
      pages: 'e0173461',
      doi: '10.1371/journal.pone.0173461',
      issn: '1932-6203',
      year: 2017,
      language: 'en',
    });
  });

  it('unwraps a DOI stored as a doi.org URL in dc:identifier', () => {
    const xmp = { getAll: () => ({ 'dc:identifier': 'https://doi.org/10.1038/nature12373' }) };

    expect(extractMetadataFromXmp(xmp)?.doi).toBe('10.1038/nature12373');
  });

  it('cleans a DOI stored with a query and a publisher tail', () => {
    const xmp = { getAll: () => ({ 'dc:identifier': 'https://example.org/doi/10.1002/anie.201915678/abstract?x=1' }) };

    expect(extractMetadataFromXmp(xmp)?.doi).toBe('10.1002/anie.201915678');
  });

  it('reads a Map and language-alternative values', () => {
    const xmp = {
      getAll: () => new Map<string, unknown>([['dc:title', { 'x-default': 'Mapped Title' }]]),
    };

    expect(extractMetadataFromXmp(xmp)?.title).toBe('Mapped Title');
  });

  it('returns undefined when there is no XMP packet', () => {
    expect(extractMetadataFromXmp(undefined)).toBeUndefined();
    expect(extractMetadataFromXmp({ getAll: () => ({}) })).toBeUndefined();
  });
});
