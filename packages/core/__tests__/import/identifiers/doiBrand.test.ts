/** Contract of the Doi brand: which strings count as a DOI and how a plain string becomes one. */

import { isDoi, toDoi } from '@labshelf/core';

describe('isDoi', () => {
  it('accepts a DOI with a multi-part registrant prefix', () => {
    expect(isDoi('10.1000.10/x')).toBe(true);
  });

  it.each(['abc', '10.12/x', '', 42, undefined, null])('rejects %p', (value) => {
    expect(isDoi(value)).toBe(false);
  });
});

describe('toDoi', () => {
  it('returns the same text when it is a DOI', () => {
    expect(toDoi('10.1234/abc')).toBe('10.1234/abc');
  });

  it('returns undefined when it is not a DOI', () => {
    expect(toDoi('abc')).toBeUndefined();
  });
});
