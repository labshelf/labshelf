/** Unit tests for telling real titles from filenames and placeholders in PDF metadata. */

import { deriveUsableTitle } from '@labshelf/core';

describe('usableTitle', () => {
  it('rejects a filename left in Info.Title by the producer', () => {
    expect(deriveUsableTitle('15200863156991 1..46 - 28383.pdf')).toBeUndefined();
    expect(deriveUsableTitle('Microsoft Word - manuscript_final.doc')).toBeUndefined();
  });

  it('rejects the window title a viewer stamps on a page printed from it', () => {
    expect(deriveUsableTitle('PDF.js viewer')).toBeUndefined();
    expect(deriveUsableTitle('Adobe Acrobat Reader')).toBeUndefined();
    expect(deriveUsableTitle('Viewer-Based Rendering of Large PDF Archives')).toBeDefined();
  });

  it('rejects placeholder and numeric job names', () => {
    expect(deriveUsableTitle('Untitled')).toBeUndefined();
    expect(deriveUsableTitle('No Job Name')).toBeUndefined();
    expect(deriveUsableTitle('1520-0863 12 3 4455')).toBeUndefined();
  });

  it('rejects a long unbroken slug', () => {
    expect(deriveUsableTitle('a'.repeat(60))).toBeUndefined();
  });

  it('keeps a genuine paper title', () => {
    const title = 'Attention Is All You Need';
    expect(deriveUsableTitle(title)).toBe(title);
  });
});
