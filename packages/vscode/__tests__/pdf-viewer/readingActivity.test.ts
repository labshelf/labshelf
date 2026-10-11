import { ReadingActivityTracker } from '../../src/pdf-viewer/readingActivity';

describe('ReadingActivityTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => { jest.useRealTimers(); });

  const at = (seconds: number) => jest.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)));

  it('records open, a page dwell of at least five seconds, annotate and close', () => {
    const sink = jest.fn();
    const tracker = new ReadingActivityTracker('p1', sink);
    tracker.opened();
    at(2);
    tracker.pageChanged(2); // 2 s on page 1: skimmed
    at(10);
    tracker.pageChanged(3); // 8 s on page 2: read
    tracker.annotated(3);
    expect(tracker.closed()).toBe(3);
    const events = sink.mock.calls.map((c) => c[0]);
    expect(events.map((e) => e.kind)).toEqual(['open', 'scroll', 'annotate', 'close']);
    expect(events[1]).toMatchObject({ paperId: 'p1', page: 2, durationMs: 8000 });
    expect(events[3]).toMatchObject({ kind: 'close', page: 3, durationMs: 10000 });
  });

  it('ignores a report of the page it is already on', () => {
    const sink = jest.fn();
    const tracker = new ReadingActivityTracker('p1', sink);
    tracker.opened();
    at(30);
    tracker.pageChanged(1);
    expect(sink.mock.calls.map((c) => c[0].kind)).toEqual(['open']);
  });

  it('does not count time while the panel is hidden', () => {
    const sink = jest.fn();
    const tracker = new ReadingActivityTracker('p1', sink);
    tracker.opened();
    at(1);
    tracker.visibilityChanged(false);
    jest.setSystemTime(new Date('2026-01-01T01:00:00Z'));
    tracker.visibilityChanged(true);
    jest.setSystemTime(new Date('2026-01-01T01:00:02Z'));
    tracker.pageChanged(2);
    expect(sink.mock.calls.map((c) => c[0].kind)).toEqual(['open']);
  });

  it('survives a throwing sink and works without one', () => {
    const tracker = new ReadingActivityTracker('p1', () => { throw new Error('db closed'); });
    expect(() => { tracker.opened(); tracker.closed(); }).not.toThrow();
    expect(() => new ReadingActivityTracker('p1', undefined).closed()).not.toThrow();
  });
});
