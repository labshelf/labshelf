/**
 * Tests the paper status list, its guard, its labels and the click-to-cycle order.
 */
import { PAPER_STATUSES, STATUS_LABEL, isReadingStatus, deriveNextReadingStatus } from '@labshelf/core';

describe('paper status', () => {
  it('lists the statuses in display order', () => {
    expect(PAPER_STATUSES).toEqual(['unread', 'reading', 'done']);
  });

  it('accepts only listed statuses', () => {
    for (const status of PAPER_STATUSES) { expect(isReadingStatus(status)).toBe(true); }
    for (const value of ['Unread', '', undefined, null, 3, {}]) { expect(isReadingStatus(value)).toBe(false); }
  });

  it('labels each status in the product vocabulary', () => {
    expect(PAPER_STATUSES.map((s) => STATUS_LABEL[s])).toEqual(['Unread', 'Reading', 'Done']);
  });

  it('cycles unread, reading, done, then unread', () => {
    expect(deriveNextReadingStatus('unread')).toBe('reading');
    expect(deriveNextReadingStatus('reading')).toBe('done');
    expect(deriveNextReadingStatus('done')).toBe('unread');
  });
});
