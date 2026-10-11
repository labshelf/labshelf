// Tests annotation position validation.
import { validateAnnotationPosition } from '../../../src/reader/sidecar/annotationValidation';

describe('validateAnnotationPosition', () => {
  it('accepts a normalized box and rejects anything outside the page', () => {
    expect(validateAnnotationPosition({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 })).toEqual({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
    expect(() => validateAnnotationPosition({ x: 0.9, y: 0, width: 0.2, height: 0.1 })).toThrow('normalized');
    expect(() => validateAnnotationPosition({ x: '0' })).toThrow('numbers');
    expect(() => validateAnnotationPosition(null)).toThrow('object');
  });
});
