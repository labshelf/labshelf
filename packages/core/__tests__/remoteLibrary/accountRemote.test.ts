/** Pins the Account tab's Remote access over the core access: the flag, details, settings and the store move with the bucket binding. */
import { createAccountRemote } from '../../src/remoteLibrary/accountRemote';
import type { MirrorStorage } from '../../src/remoteLibrary/mirrorRunner';

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
    status: jest.fn(async () => STATUS),
    setIncludePdfs: jest.fn(async (_on: boolean): Promise<Result> => ({ ok: true })),
    setLimit: jest.fn(async (_bytes: number | null): Promise<Result> => ({ ok: true })),
    moveStore: jest.fn(async (store: 'do' | 'r2'): Promise<Result> => { calls.push(`move:${store}`); return moveResult; }),
    estimatePaperPdfs: jest.fn(async () => ({ bytes: 10, files: 1 })),
  };
  let moveResult: Result = { ok: true };
  let storage: MirrorStorage | undefined;
  const bucket = {
    bind: jest.fn(async () => { calls.push('bind'); }),
    unbind: jest.fn(async () => { calls.push('unbind'); }),
  };
  const remote = createAccountRemote({ flag, access, bucket, lastStorage: () => storage });
  return {
    state, calls, flag, access, bucket, remote,
    setMoveResult: (result: Result) => { moveResult = result; },
    setStorage: (value: MirrorStorage | undefined) => { storage = value; },
  };
}

const STATUS = {
  generation: 'g1', store: 'do' as const, used: 50, limit: 100, includePdfs: false, rows: 3, edits: 0,
  r2: { bound: false, month: '2026-11', operations: 0 },
};

describe('createAccountRemote details and settings', () => {
  it('details is undefined while off', async () => {
    const t = setupAccess(false);
    expect(await t.remote.details()).toBeUndefined();
    expect(t.access.status).not.toHaveBeenCalled();
  });

  it('details merges the status with the last sync storage, and is empty before any sync', async () => {
    const t = setupAccess(true);
    expect(await t.remote.details()).toEqual({
      store: 'do', used: 50, limit: 100, includePdfs: false, r2Bound: false, warn: false, full: false, leftOut: [],
    });
    t.setStorage({ store: 'do', used: 95, limit: 100, warn: true, full: false, leftOut: ['papers/a.pdf'] });
    expect(await t.remote.details()).toMatchObject({ used: 50, warn: true, full: false, leftOut: ['papers/a.pdf'] });
  });

  it('details is undefined when the status cannot be read', async () => {
    const t = setupAccess(true);
    t.access.status.mockRejectedValueOnce(new Error('offline'));
    expect(await t.remote.details()).toBeUndefined();
  });

  it('moveStore r2 binds the bucket first, then moves', async () => {
    const t = setupAccess(true);
    expect(await t.remote.moveStore('r2')).toEqual({ ok: true });
    expect(t.calls).toEqual(['bind', 'move:r2']);
  });

  it('moveStore r2 answers the bind failure and does not move', async () => {
    const t = setupAccess(true);
    t.bucket.bind.mockRejectedValueOnce(new Error('Create the R2 bucket labshelf-mirror first'));
    expect(await t.remote.moveStore('r2')).toEqual({ ok: false, message: 'Create the R2 bucket labshelf-mirror first' });
    expect(t.access.moveStore).not.toHaveBeenCalled();
  });

  it('moveStore do moves first, then unbinds; a failed move keeps the binding', async () => {
    const t = setupAccess(true);
    expect(await t.remote.moveStore('do')).toEqual({ ok: true });
    expect(t.calls).toEqual(['move:do', 'unbind']);
    const f = setupAccess(true);
    f.setMoveResult({ ok: false, reason: 'failed', message: 'nope' });
    expect(await f.remote.moveStore('do')).toEqual({ ok: false, message: 'nope' });
    expect(f.bucket.unbind).not.toHaveBeenCalled();
  });

  it('settings answer the access result without its reason', async () => {
    const t = setupAccess(true);
    t.access.setLimit.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'too big' });
    expect(await t.remote.setLimit(1)).toEqual({ ok: false, message: 'too big' });
    expect(await t.remote.setIncludePdfs(true)).toEqual({ ok: true });
    expect(await t.remote.estimatePaperPdfs()).toEqual({ bytes: 10, files: 1 });
  });
});

describe('createAccountRemote', () => {
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

