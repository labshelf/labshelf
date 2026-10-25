/** Title-overlap scoring used to confirm an online match against the text a PDF carries. */

import { deriveTitleOverlap } from '@labshelf/core';

describe('titleOverlap', () => {
  it('scores identical strings as a full match', () => {
    const title = 'Attention Is All You Need';

    expect(deriveTitleOverlap(title, title)).toBe(1);
  });

  it('scores a candidate title fully contained in a longer page as a full match', () => {
    const candidate = 'Attention Is All You Need';
    const page =
      'NeurIPS 2017\nAttention Is All You Need\nAshish Vaswani, Noam Shazeer, et al.\nAbstract...';

    expect(deriveTitleOverlap(candidate, page)).toBe(1);
  });

  it('scores a completely different title as a low match', () => {
    expect(
      deriveTitleOverlap('Attention Is All You Need', 'A Survey of Deep Reinforcement Learning'),
    ).toBeLessThan(0.3);
  });

  it('returns 0 for an empty candidate', () => {
    expect(deriveTitleOverlap('', 'Attention Is All You Need')).toBe(0);
  });
});
