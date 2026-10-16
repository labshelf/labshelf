/**
 * Unit tests for the heuristics that scan a PDF's metadata, link annotations
 * and text for DOI/arXiv/PMID/PMCID/ISBN candidates.
 */

import { detectIdentifiers } from '@labshelf/core';

describe('detectIdentifiers', () => {
  it('finds multiple DOIs in the text and dedupes repeats', () => {
    const text = '10.1038/nature12373 is cited elsewhere as 10.1038/nature12373';

    const identifiers = detectIdentifiers({}, text);

    expect(identifiers.filter((identifier) => identifier.type === 'doi')).toEqual([
      { type: 'doi', value: '10.1038/nature12373' },
    ]);
  });

  it('finds a PMID from a labelled reference', () => {
    const identifiers = detectIdentifiers({}, 'PMID: 28796665');

    expect(identifiers).toContainEqual({ type: 'pmid', value: '28796665' });
  });

  it('finds a PMC id and upper-cases it', () => {
    const identifiers = detectIdentifiers({}, 'available at PMC5560867');

    expect(identifiers).toContainEqual({ type: 'pmcid', value: 'PMC5560867' });
  });

  it('finds an ISBN', () => {
    const identifiers = detectIdentifiers({}, 'ISBN: 978-3-16-148410-0');

    expect(identifiers).toContainEqual({ type: 'isbn', value: '9783161484100' });
  });

  it('finds an arXiv id from an explicit label', () => {
    const identifiers = detectIdentifiers({}, 'arXiv:1706.03762v7');

    expect(identifiers).toContainEqual({ type: 'arxiv', value: '1706.03762' });
  });

  it('finds an old-style arXiv id from a label, with or without the colon and the version', () => {
    expect(detectIdentifiers({}, 'arXiv:hep-th/9711200')).toContainEqual({ type: 'arxiv', value: 'hep-th/9711200' });
    expect(detectIdentifiers({}, 'arXiv hep-th/9711200v2 [hep-th] 27 Nov 1997')).toContainEqual({ type: 'arxiv', value: 'hep-th/9711200' });
    expect(detectIdentifiers({}, 'arXiv:math.GT/0309136v1')).toContainEqual({ type: 'arxiv', value: 'math.GT/0309136' });
  });

  it('finds an old-style arXiv id from a link URL', () => {
    expect(detectIdentifiers({}, '', ['https://arxiv.org/abs/hep-th/9711200v3'])).toContainEqual({ type: 'arxiv', value: 'hep-th/9711200' });
  });

  it('finds an arXiv id from a link URL', () => {
    const identifiers = detectIdentifiers({}, '', ['https://arxiv.org/abs/1706.03762']);

    expect(identifiers).toContainEqual({ type: 'arxiv', value: '1706.03762' });
  });

  it('does not treat a bare decimal number as an arXiv id without context', () => {
    const identifiers = detectIdentifiers({}, 'pages 1706.03762 of volume 12');

    expect(identifiers.some((identifier) => identifier.type === 'arxiv')).toBe(false);
  });

  it('recovers a DOI split across text items', () => {
    const identifiers = detectIdentifiers({}, 'https://doi.org/10.1038/ nature12373');

    expect(identifiers).toContainEqual({ type: 'doi', value: '10.1038/nature12373' });
  });

  it('ranks a labelled identifier ahead of an earlier unlabelled match', () => {
    const text = 'References 10.9999/old.reference ... doi:10.1038/nature12373';

    const identifiers = detectIdentifiers({}, text);

    expect(identifiers[0]).toEqual({ type: 'doi', value: '10.1038/nature12373' });
  });
});

describe('detectIdentifiers DOI cleanup', () => {
  const doiIn = (text: string, links: string[] = []) =>
    detectIdentifiers({}, text, links).find((identifier) => identifier.type === 'doi')?.value;

  it('keeps balanced brackets when stripping trailing punctuation', () => {
    expect(doiIn('doi:10.1016/j.x.2020(1).')).toBe('10.1016/j.x.2020(1)');
  });

  it('drops a closing bracket the DOI never opened', () => {
    expect(doiIn('(doi:10.1145/10515.10546)')).toBe('10.1145/10515.10546');
  });

  it('drops a ".pdf" extension on a link target', () => {
    expect(doiIn('', ['https://link.springer.com/content/pdf/10.1007/s10107-023-01234-5.pdf'])).toBe(
      '10.1007/s10107-023-01234-5',
    );
  });

  it('drops a publisher path tail on a link target', () => {
    expect(doiIn('', ['https://onlinelibrary.wiley.com/doi/10.1002/anie.201915678/abstract'])).toBe(
      '10.1002/anie.201915678',
    );
  });

  it('decodes percent-encoding in a link target', () => {
    expect(doiIn('', ['https://www.example.org/doi/10.1000%2Fxyz123'])).toBe('10.1000/xyz123');
  });

  it('keeps a SICI DOI whole', () => {
    const sici = '10.1002/(SICI)1097-4571(199806)49:8<693::AID-ASI4>3.0.CO;2-O';

    expect(doiIn(`doi:${sici}`)).toBe(sici);
  });
});

const firstIdentifier = (...args: Parameters<typeof detectIdentifiers>) => detectIdentifiers(...args)[0];

describe('detectIdentifiers', () => {
  it('reads a DOI from a link annotation when the text layer is unusable', () => {
    const identifier = firstIdentifier({}, 'WrnE ynEENFCnAMNAyN', [
      'https://doi.org/10.1371/journal.pone.0173461',
    ]);

    expect(identifier).toEqual({ type: 'doi', value: '10.1371/journal.pone.0173461' });
  });

  it('prefers a labelled DOI over an earlier bibliography match', () => {
    const text = 'References 10.9999/old.reference ... doi:10.1038/nature12373';

    expect(firstIdentifier({}, text)).toEqual({ type: 'doi', value: '10.1038/nature12373' });
  });

  it('recovers a DOI split across text items', () => {
    expect(firstIdentifier({}, 'https://doi.org/10.1038/ nature12373')).toEqual({
      type: 'doi',
      value: '10.1038/nature12373',
    });
  });

  it('strips trailing punctuation from a DOI', () => {
    expect(firstIdentifier({}, 'doi:10.1038/nature12373.')).toEqual({
      type: 'doi',
      value: '10.1038/nature12373',
    });
  });

  it('does not mistake an arbitrary decimal number for an arXiv id', () => {
    // A page range, a version string and a measurement all match `dddd.dddd`.
    expect(firstIdentifier({}, 'pages 1706.03762 of volume 12')).toBeUndefined();
    expect(firstIdentifier({}, 'measured 2017.1234 units')).toBeUndefined();
  });

  it('accepts an arXiv id with explicit context', () => {
    expect(firstIdentifier({}, 'arXiv:1706.03762v7')).toEqual({
      type: 'arxiv',
      value: '1706.03762',
    });
    expect(firstIdentifier({}, '', ['https://arxiv.org/abs/1706.03762'])).toEqual({
      type: 'arxiv',
      value: '1706.03762',
    });
  });
});
