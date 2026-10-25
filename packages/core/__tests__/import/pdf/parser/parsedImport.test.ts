import { SOURCE_TRUST, type ResolvedMetadata } from '@labshelf/core';

import { createParsedPaperRecord } from '../../../../src/import/pdf/parser/parsedImport';

function recordFrom(...sources: Array<{ name: string; trust: number; metadata: ResolvedMetadata }>) {
  return createParsedPaperRecord({
    sources,
    fileStem: 'download',
    frontMatter: '',
    textIsReadable: true,
    identifiers: [],
    identifierConfirmed: false,
    resolvedOnline: false,
    origin: undefined,
    usedOcr: false,
  });
}

const FITNESS = { title: 'Fitness flux and ubiquity of adaptive evolution', authors: ['Ville Mustonen', 'Michael Lässig'], year: 2009 };

describe('buildParsedRecord cite key', () => {
  it('leaves the surname out when the authors come only from the page layout', () => {
    const layoutAuthor = 'SIAM J. COMPUT. © 1986 Society for Industrial';
    const record = recordFrom({
      name: 'layout',
      trust: SOURCE_TRUST.layout,
      metadata: { title: 'Downloaded 12/01/24 to 143.107.45.12', authors: [layoutAuthor], year: 1986 },
    });

    expect(record.citeKey).toBe('1986downloaded');
    expect(record.authors).toEqual([layoutAuthor]);
  });

  it('leaves the surname out when a trusted source gives the title but not the authors', () => {
    const record = recordFrom(
      { name: 'xmp', trust: SOURCE_TRUST.xmp, metadata: { title: FITNESS.title, year: 2009 } },
      { name: 'info', trust: SOURCE_TRUST.info, metadata: { authors: ['Someone Else'] } },
    );
    expect(record.citeKey).toBe('2009fitness');
  });

  it('builds authorYearWord from XMP authors', () => {
    expect(recordFrom({ name: 'xmp', trust: SOURCE_TRUST.xmp, metadata: FITNESS }).citeKey).toBe('mustonen2009fitness');
  });

  it('builds authorYearWord from a confirmed identifier record', () => {
    const record = recordFrom(
      { name: 'registry', trust: SOURCE_TRUST.confirmedIdentifier, metadata: FITNESS },
      { name: 'layout', trust: SOURCE_TRUST.layout, metadata: { authors: ['Wrong Name'] } },
    );
    expect(record.citeKey).toBe('mustonen2009fitness');
  });
});
