/** Unit tests for the PDF Info dictionary: timestamp trust and publisher-stamped keys. */

import { extractPublisherMetadata, hasTrustworthyTimestamps } from '@labshelf/core';

describe('timestampsAreTrustworthy', () => {
  it('distrusts timestamps written by a print-to-PDF re-save', () => {
    expect(
      hasTrustworthyTimestamps({
        Producer: 'macOS Versão 27.0 (Compilação 26A428) Quartz PDFContext',
        Creator: 'Firefox Developer Edition',
      }),
    ).toBe(false);
  });

  it('trusts timestamps from a typesetting pipeline', () => {
    expect(hasTrustworthyTimestamps({ Producer: 'pdfTeX-1.40.21', Creator: 'LaTeX' })).toBe(true);
  });
});

describe('publisherMetadataFromInfo', () => {
  it('harvests the non-standard keys a publisher stamps into the Info dictionary', () => {
    const info = {
      'WPS-ARTICLEDOI': '10.1002/anie.201712345',
      JournalTitle: 'Angewandte Chemie International Edition',
      VolumeNum: '57',
      IssueNum: '12',
      FirstPage: '3120',
      LastPage: '3135',
      ISSN: '1433-7851',
      Publisher: 'Wiley-VCH Verlag GmbH',
      Copyright: '© 2018 Wiley-VCH Verlag GmbH & Co. KGaA, Weinheim',
    };

    expect(extractPublisherMetadata(info)).toEqual({
      doi: '10.1002/anie.201712345',
      journal: 'Angewandte Chemie International Edition',
      volume: '57',
      issue: '12',
      pages: '3120-3135',
      issn: '1433-7851',
      publisher: 'Wiley-VCH Verlag GmbH',
      year: 2018,
    });
  });

  it('unwraps a prefixed DOI and keeps a lone first page', () => {
    expect(extractPublisherMetadata({ doi: 'doi:10.1038/nature12373.', FirstPage: 'e0173461' })).toEqual({
      doi: '10.1038/nature12373',
      pages: 'e0173461',
    });
  });

  it('keeps the balanced brackets of a DOI', () => {
    expect(extractPublisherMetadata({ doi: 'doi:10.1016/j.x.2020(1).' })).toEqual({ doi: '10.1016/j.x.2020(1)' });
  });

  it('returns undefined when the dictionary holds nothing bibliographic', () => {
    expect(extractPublisherMetadata({ Producer: 'pdfTeX-1.40.21', Creator: 'LaTeX' })).toBeUndefined();
    expect(extractPublisherMetadata({ Journal: '   ', Volume: 12 })).toBeUndefined();
    expect(extractPublisherMetadata({})).toBeUndefined();
  });
});
