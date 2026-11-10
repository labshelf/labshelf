/** Pins the desktop Cloudflare email cache and the Mirror trigger (debounced runs and the edits pull). */
import { createCloudflareEmailCache, createMirrorTrigger } from '../../../src/relay/node/remoteLibrary';

interface FakeTimer { fn: () => void; ms: number; cleared: boolean }

describe('createCloudflareEmailCache', () => {
  it('reads once per relay and asks again after a failure', async () => {
    const read = jest.fn(async (url: string) => `me@${url}`);
    const email = createCloudflareEmailCache(read);
    expect(await email('a')).toBe('me@a');
    expect(await email('a')).toBe('me@a');
    expect(read).toHaveBeenCalledTimes(1);
    read.mockRejectedValueOnce(new Error('x'));
    expect(await email('b')).toBeUndefined();
    expect(await email('b')).toBe('me@b');
  });
});

function setupTrigger(initialOn: boolean, extra: { delayMs?: number } = {}) {
  const timers: FakeTimer[] = [];
  const state = { on: initialOn };
  const runs: { resolve: () => void }[] = [];
  const run = jest.fn(() => new Promise<void>((resolve) => { runs.push({ resolve }); }));
  const clearTimer = jest.fn((handle: unknown) => { (handle as FakeTimer).cleared = true; });
  const trigger = createMirrorTrigger({
    isOn: () => state.on,
    run,
    ...extra,
    setTimer: (fn, ms) => { const timer: FakeTimer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimer,
  });
  const active = () => timers.filter((timer) => !timer.cleared);
  /** Fires every timer that has not been cleared, once. */
  const fire = () => { for (const timer of active()) { timer.cleared = true; timer.fn(); } };
  return { trigger, timers, state, run, runs, active, fire, clearTimer };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('createMirrorTrigger', () => {
  it('4.2b several changed() calls produce one run after the delay, 30 s by default', async () => {
    const t = setupTrigger(true);
    t.trigger.changed();
    t.trigger.changed();
    t.trigger.changed();
    expect(t.run).not.toHaveBeenCalled();
    const live = t.active();
    expect(live).toHaveLength(1);
    expect(live[0]?.ms).toBe(30000);
    t.fire();
    await flush();
    expect(t.run).toHaveBeenCalledTimes(1);
  });

  it('4.2b the delay follows delayMs', () => {
    const t = setupTrigger(true, { delayMs: 1234 });
    t.trigger.changed();
    expect(t.active().map((timer) => timer.ms)).toEqual([1234]);
  });

  it('4.2b a later changed() restarts the timer instead of keeping the first one', async () => {
    const t = setupTrigger(true);
    t.trigger.changed();
    const first = t.timers[0]!;
    t.trigger.changed();
    // The first timer must no longer be able to fire a run.
    expect(first.cleared).toBe(true);
    expect(t.clearTimer).toHaveBeenCalledWith(first);
  });

  it('4.2b no run when isOn() is false at fire time', async () => {
    const t = setupTrigger(false);
    t.trigger.changed();
    t.fire();
    await flush();
    expect(t.run).not.toHaveBeenCalled();
  });

  it('4.2b isOn() is checked when the timer fires, not when changed() was called', async () => {
    const t = setupTrigger(true);
    t.trigger.changed();
    t.state.on = false;
    t.fire();
    await flush();
    expect(t.run).not.toHaveBeenCalled();
  });

  it('4.2b start() runs at once when isOn()', async () => {
    const t = setupTrigger(true);
    t.trigger.start();
    await flush();
    expect(t.run).toHaveBeenCalledTimes(1);
  });

  it('4.2b start() does nothing when isOn() is false', async () => {
    const t = setupTrigger(false);
    t.trigger.start();
    t.fire();
    await flush();
    expect(t.run).not.toHaveBeenCalled();
  });

  it('4.2b a changed() during a run schedules exactly one more run after it ends', async () => {
    const t = setupTrigger(true);
    t.trigger.changed();
    t.fire();
    await flush();
    expect(t.run).toHaveBeenCalledTimes(1);

    // A change arrives while the first run is still in progress, twice.
    t.trigger.changed();
    t.trigger.changed();
    t.fire();
    await flush();
    expect(t.run).toHaveBeenCalledTimes(1); // never two runs at once

    t.runs[0]!.resolve();
    await flush();
    t.fire(); // the follow-up may wait on a timer
    await flush();
    expect(t.run).toHaveBeenCalledTimes(2);

    t.runs[1]?.resolve();
    await flush();
    t.fire();
    await flush();
    expect(t.run).toHaveBeenCalledTimes(2); // exactly one more
  });

  it('4.2b no further run after a run that saw no change', async () => {
    const t = setupTrigger(true);
    t.trigger.changed();
    t.fire();
    await flush();
    t.runs[0]!.resolve();
    await flush();
    t.fire();
    await flush();
    expect(t.run).toHaveBeenCalledTimes(1);
  });

  it('4.2b dispose() clears the pending timer so no run happens', async () => {
    const t = setupTrigger(true);
    t.trigger.changed();
    const pending = t.timers[0]!;
    t.trigger.dispose();
    expect(t.clearTimer).toHaveBeenCalledWith(pending);
    t.fire();
    await flush();
    expect(t.run).not.toHaveBeenCalled();
  });
});

describe('createMirrorTrigger pull', () => {
  function setupPull(on = true) {
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const trigger = createMirrorTrigger({
      isOn: () => on,
      run: jest.fn(() => new Promise<void>((resolve) => { calls.push('run'); release = resolve; })),
      pull: jest.fn(async () => { calls.push('pull'); }),
      setTimer: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
      clearTimer: (handle) => { (handle as { cleared: boolean }).cleared = true; },
    });
    const pullTimers = () => timers.filter((timer) => timer.ms === 60_000 && !timer.cleared);
    return { trigger, calls, pullTimers, finishRun: () => release?.() };
  }

  it('start() schedules a pull every 60 s, skipped while a run holds the queue', async () => {
    const t = setupPull();
    t.trigger.start();
    expect(t.calls).toEqual(['run']);
    const first = t.pullTimers()[0]!;
    first.cleared = true;
    first.fn();
    await flush();
    expect(t.calls).toEqual(['run']);
    t.finishRun();
    await flush();
    const second = t.pullTimers()[0]!;
    second.cleared = true;
    second.fn();
    await flush();
    expect(t.calls).toEqual(['run', 'pull']);
    expect(t.pullTimers()).toHaveLength(1);
  });

  it('no pull while off, and dispose clears the pull timer', async () => {
    const t = setupPull(false);
    t.trigger.start();
    const timer = t.pullTimers()[0]!;
    timer.cleared = true;
    timer.fn();
    await flush();
    expect(t.calls).toEqual([]);
    t.trigger.dispose();
    expect(t.pullTimers()).toHaveLength(0);
  });
});
