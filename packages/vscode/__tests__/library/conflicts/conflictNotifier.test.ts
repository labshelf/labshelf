import { ConflictNotifier, conflictMessage } from '../../../src/library/conflicts/conflictNotifier';

describe('ConflictNotifier', () => {
  it('notifies for a new non-zero count and stays quiet for a repeat', () => {
    const notifier = new ConflictNotifier();
    expect(notifier.shouldNotify(0)).toBe(false);
    expect(notifier.shouldNotify(2)).toBe(true);
    expect(notifier.shouldNotify(2)).toBe(false);
    expect(notifier.shouldNotify(3)).toBe(true);
  });

  it('notifies again after the count dropped to zero', () => {
    const notifier = new ConflictNotifier();
    notifier.shouldNotify(2);
    notifier.shouldNotify(0);
    expect(notifier.shouldNotify(2)).toBe(true);
  });

  it('does not notify for a count the user already saw', () => {
    const notifier = new ConflictNotifier();
    notifier.shouldNotify(3);
    notifier.markSeen(1);
    expect(notifier.shouldNotify(1)).toBe(false);
  });
});

describe('conflictMessage', () => {
  it('uses the singular for one file', () => {
    expect(conflictMessage(1)).toBe('1 file has a conflicting copy');
    expect(conflictMessage(2)).toBe('2 files have conflicting copies');
  });
});
