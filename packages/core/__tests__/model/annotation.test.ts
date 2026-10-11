/**
 * Tests the annotation colour list and the colour guard.
 */
import { ANNOTATION_COLORS, isAnnotationColor } from '@labshelf/core';

describe('annotation lists', () => {
  it('lists the colours in display order', () => {
    expect(ANNOTATION_COLORS).toEqual(['yellow', 'green', 'blue', 'red', 'pink']);
  });

  it('accepts only listed colours', () => {
    for (const color of ANNOTATION_COLORS) { expect(isAnnotationColor(color)).toBe(true); }
    for (const value of ['purple', '', undefined, null, 2]) { expect(isAnnotationColor(value)).toBe(false); }
  });
});
