/** Pins the desktop Remote access switch (flag plus access) and the debounced mirror trigger. */
import { createDesktopRemoteAccess, createMirrorTrigger } from '../../../src/relay/node/remoteLibrary';

type Result = { ok: true } | { ok: false; reason: 'needs_sign_in' | 'no_relay' | 'failed'; message: string };

const SIGN_IN = 'Remote access needs Cloudflare sign-in';

function setupAccess(initial: boolean, onResult: Result = { ok: true }, offResult: Result = { ok: true }) {
  const state = { on: initial };
  const calls: string[] = [];
  const flag = {
    read: jest.fn(() => state.on),
    write: jest.fn(async (on: boolean) => { calls.push(`write:${on}`); state.on = on; }),
  };
  const access = {
    turnOn: jest.fn(async () => { calls.push('turnOn'); return onResult; }),
    turnOff: jest.fn(async () => { calls.push('turnOff'); return offResult; }),
  };
  const remote = createDesktopRemoteAccess({ flag, access });
  return { state, calls, flag, access, remote };
}

describe('createDesktopRemoteAccess', () => {
  it('4.2a read answers the stored flag', async () => {
    const off = setupAccess(false);
    expect(await off.remote.read()).toEqual({ on: false });
    const on = setupAccess(true);
    expect(await on.remote.read()).toEqual({ on: true });
  });

  it('4.2a set(true) turns on through the access and then stores the flag', async () => {
    const t = setupAccess(false);
    const result = await t.remote.set(true);
    expect(result.ok).toBe(true);
    expect(t.access.turnOn).toHaveBeenCalledTimes(1);
    expect(t.access.turnOff).not.toHaveBeenCalled();
    expect(t.flag.write).toHaveBeenCalledWith(true);
    expect(t.calls).toEqual(['turnOn', 'write:true']);
    expect(t.state.on).toBe(true);
  });

  it('4.2a set(false) turns off through the access and stores the flag false', async () => {
    const t = setupAccess(true);
    const result = await t.remote.set(false);
    expect(result.ok).toBe(true);
    expect(t.access.turnOff).toHaveBeenCalledTimes(1);
    expect(t.access.turnOn).not.toHaveBeenCalled();
    expect(t.flag.write).toHaveBeenCalledWith(false);
    expect(t.state.on).toBe(false);
  });

  it('4.2a a needs_sign_in result answers its message and leaves the flag off', async () => {
    const t = setupAccess(false, { ok: false, reason: 'needs_sign_in', message: SIGN_IN });
    const result = await t.remote.set(true);
    expect(result).toMatchObject({ ok: false, message: SIGN_IN });
    expect(t.flag.write).not.toHaveBeenCalled();
    expect(t.state.on).toBe(false);
    expect(await t.remote.read()).toEqual({ on: false });
  });

  it('4.2a a failed turnOn leaves the flag as it was', async () => {
    const t = setupAccess(false, { ok: false, reason: 'failed', message: 'boom' });
    const result = await t.remote.set(true);
    expect(result).toMatchObject({ ok: false, message: 'boom' });
    expect(t.flag.write).not.toHaveBeenCalled();
    expect(t.state.on).toBe(false);
  });

  it('4.2a a failed turnOff leaves the flag on', async () => {
    const t = setupAccess(true, { ok: true }, { ok: false, reason: 'failed', message: 'cannot clear' });
    const result = await t.remote.set(false);
    expect(result).toMatchObject({ ok: false, message: 'cannot clear' });
    expect(t.flag.write).not.toHaveBeenCalled();
    expect(t.state.on).toBe(true);
  });
});

interface FakeTimer { fn: () => void; ms: number; cleared: boolean }

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
