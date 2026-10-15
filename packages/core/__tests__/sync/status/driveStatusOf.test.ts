import type { SyncStatus } from '../../../src/sync/coordinator/index';
import type { SyncRunRecord } from '../../../src/sync/engine/index';
import { driveStatusOf } from '../../../src/sync/status/driveStatusOf';

const run = { finishedAt: '2024-03-04T14:05:00Z' } as SyncRunRecord;

describe('driveStatusOf', () => {
  it('reports a signed-out idle library with nothing to show', () => {
    expect(driveStatusOf({ state: 'disconnected' }, false)).toEqual({ connected: false, syncing: false, lastSyncTime: null, lastError: null });
  });

  it('takes the sign-in from the caller, not from the coordinator state', () => {
    expect(driveStatusOf({ state: 'disconnected' }, true).connected).toBe(true);
  });

  it('marks syncing only while the coordinator is syncing', () => {
    expect(driveStatusOf({ state: 'syncing' }, true).syncing).toBe(true);
    expect(driveStatusOf({ state: 'idle' } as SyncStatus, true).syncing).toBe(false);
  });

  it('carries the last run time and the last error', () => {
    expect(driveStatusOf({ state: 'idle', lastRun: run, lastError: 'boom' } as SyncStatus, true)).toMatchObject({
      lastSyncTime: '2024-03-04T14:05:00Z',
      lastError: 'boom',
    });
  });
});
