// Tests sleep for delay, abort and the no-timer zero case.
import { sleep } from '../../src/async/sleep';

describe('sleep', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('resolves only after the delay', async () => {
    const done = jest.fn();
    void sleep(100).then(done);

    await jest.advanceTimersByTimeAsync(99);
    expect(done).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('rejects with the signal reason when aborted while waiting', async () => {
    const controller = new AbortController();
    const outcome = sleep(100, controller.signal).then(() => 'resolved', (reason: unknown) => reason);

    controller.abort('stop');

    await expect(outcome).resolves.toBe('stop');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort('early');

    await expect(sleep(100, controller.signal)).rejects.toBe('early');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('resolves without a timer for ms <= 0', async () => {
    await sleep(0);
    await sleep(-5);

    expect(jest.getTimerCount()).toBe(0);
  });
});
