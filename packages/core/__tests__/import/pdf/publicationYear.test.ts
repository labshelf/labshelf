/** Unit tests for finding the publication year in front matter. */

import { extractYearFromText } from '@labshelf/core';

describe('yearFromText', () => {
  it('reads the year from a copyright line', () => {
    expect(extractYearFromText('Copyright 2016 Altemose et al. All rights reserved.')).toBe(2016);
  });

  it('reads the year from a publication date line', () => {
    expect(extractYearFromText('Received: 13 May 2016 / Accepted: 2 October 2016')).toBe(2016);
  });

  it('returns undefined when no year is stated', () => {
    expect(extractYearFromText('A paper about proteins with no dates at all')).toBeUndefined();
  });
});
