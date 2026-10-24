// Tests the debouncer for trailing call execution.
import { createDebouncer } from '../../../src/reader/navigation/debounce';

describe('createDebouncer', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('fires the trailing call with the latest arguments once the timer runs', () => {
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800);

    debouncer.call('first');
    debouncer.call('second');
    debouncer.call('third');
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(800);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('flush runs a pending call immediately, exactly once', () => {
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800);

    debouncer.call('value');
    debouncer.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('value');

    // The pending call was consumed; the timer firing later must not call fn again.
    expect(debouncer.pending).toBe(false);
  });

  it('flush with nothing pending is a no-op', () => {
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800);

    debouncer.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancel drops the pending call without invoking fn', () => {
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800);

    debouncer.call('value');
    debouncer.cancel();
    expect(debouncer.pending).toBe(false);

    debouncer.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('exposes a pending getter that reflects whether a call is scheduled', () => {
    const debouncer = createDebouncer(jest.fn(), 800);

    expect(debouncer.pending).toBe(false);
    debouncer.call('x');
    expect(debouncer.pending).toBe(true);
    debouncer.flush();
    expect(debouncer.pending).toBe(false);
  });

  it('restarts the quiet period on every call', () => {
    const fn = jest.fn();
    const debouncer = createDebouncer(fn, 800);

    debouncer.call('a');
    jest.advanceTimersByTime(400);
    debouncer.call('b');
    jest.advanceTimersByTime(400);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(400);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });
});
