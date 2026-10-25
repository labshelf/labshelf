/** Unit tests for telling real titles from filenames and placeholders in PDF metadata. */

import { usableTitle } from '@labshelf/core';

describe('usableTitle', () => {
  it('rejects a filename left in Info.Title by the producer', () => {
    expect(usableTitle('15200863156991 1..46 - 28383.pdf')).toBeUndefined();
    expect(usableTitle('Microsoft Word - manuscript_final.doc')).toBeUndefined();
  });

  it('rejects the window title a viewer stamps on a page printed from it', () => {
    expect(usableTitle('PDF.js viewer')).toBeUndefined();
    expect(usableTitle('Adobe Acrobat Reader')).toBeUndefined();
    expect(usableTitle('Viewer-Based Rendering of Large PDF Archives')).toBeDefined();
  });

  it('rejects placeholder and numeric job names', () => {
    expect(usableTitle('Untitled')).toBeUndefined();
    expect(usableTitle('No Job Name')).toBeUndefined();
    expect(usableTitle('1520-0863 12 3 4455')).toBeUndefined();
  });

  it('rejects a long unbroken slug', () => {
    expect(usableTitle('a'.repeat(60))).toBeUndefined();
  });

  it('keeps a genuine paper title', () => {
    const title = 'Attention Is All You Need';
    expect(usableTitle(title)).toBe(title);
  });
});
