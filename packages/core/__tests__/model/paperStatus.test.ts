/**
 * Tests the paper status list, its guard, its labels and the click-to-cycle order.
 */
import { PAPER_STATUSES, STATUS_LABEL, isPaperStatus, nextStatus } from '@labshelf/core';

describe('paper status', () => {
  it('lists the statuses in display order', () => {
    expect(PAPER_STATUSES).toEqual(['unread', 'reading', 'done']);
  });

  it('accepts only listed statuses', () => {
    for (const status of PAPER_STATUSES) { expect(isPaperStatus(status)).toBe(true); }
    for (const value of ['Unread', '', undefined, null, 3, {}]) { expect(isPaperStatus(value)).toBe(false); }
  });

  it('labels each status in the product vocabulary', () => {
    expect(PAPER_STATUSES.map((s) => STATUS_LABEL[s])).toEqual(['Unread', 'Reading', 'Done']);
  });

  it('cycles unread, reading, done, then unread', () => {
    expect(nextStatus('unread')).toBe('reading');
    expect(nextStatus('reading')).toBe('done');
    expect(nextStatus('done')).toBe('unread');
  });
});
