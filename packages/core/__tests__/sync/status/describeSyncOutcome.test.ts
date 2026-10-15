/** One wording of a sync run's result for every app, and which results are routine. */
import { SKIP_NOT_SIGNED_IN, type SyncOutcome } from '../../../src/sync/coordinator/index';
import type { SyncRunRecord } from '../../../src/sync/engine/index';
import { describeSyncOutcome } from '../../../src/sync/status/describeSyncOutcome';

const record = (over: Partial<SyncRunRecord> = {}): SyncRunRecord => ({
  providerId: 'gdrive', app: 'terminal', host: 'h', startedAt: '', finishedAt: '',
  uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: [], ...over,
});
const synced = (over: Partial<SyncRunRecord> = {}): SyncOutcome => ({ kind: 'synced', record: record(over), result: {} as never });

describe('describeSyncOutcome', () => {
  it('lists only what moved', () => {
    const notice = describeSyncOutcome(synced({ downloaded: 2, uploaded: 1, deletedRemote: 3 }));
    expect(notice).toMatchObject({ text: 'Synced: 2 downloaded, 1 uploaded, 3 removed on Drive', severity: 'info', routine: false });
    expect(describeSyncOutcome(synced({ deletedLocal: 1 })).text).toBe('Synced: 1 removed here');
  });

  it('calls an unchanged library routine', () => {
    expect(describeSyncOutcome(synced())).toMatchObject({ text: 'Already in sync', routine: true });
  });

  it('warns about conflicts and names each file', () => {
    const notice = describeSyncOutcome(synced({ conflicts: ['papers/a/paper.pdf'], downloaded: 1 }));
    expect(notice.text).toBe('Synced with 1 conflict: both versions kept, the remote one renamed "(conflict …)"');
    expect(notice).toMatchObject({ severity: 'warn', routine: false, details: ['conflict: papers/a/paper.pdf'] });
    expect(describeSyncOutcome(synced({ conflicts: ['a', 'b'] })).text).toContain('2 conflicts');
  });

  it('names the app holding the lock', () => {
    const holder = (app: string): SyncOutcome => ({ kind: 'busy', holder: { app, pid: 1, host: 'h', token: 't', acquiredAt: '', heartbeatAt: '' } });
    expect(describeSyncOutcome(holder('vscode')).text).toBe('VS Code is syncing this library right now; its changes will show up here');
    expect(describeSyncOutcome(holder('terminal')).text).toContain('The LabShelf terminal app is syncing');
    expect(describeSyncOutcome({ kind: 'busy', holder: undefined })).toMatchObject({ text: expect.stringContaining('Another LabShelf app'), routine: true });
  });

  it('asks for a sign-in only when the run was skipped for lack of one', () => {
    expect(describeSyncOutcome({ kind: 'skipped', reason: SKIP_NOT_SIGNED_IN })).toMatchObject({
      text: 'Sync skipped: not signed in to Google Drive', routine: true, needsSignIn: true,
    });
    expect(describeSyncOutcome({ kind: 'skipped', reason: 'no Google OAuth client configured' }).needsSignIn).toBe(false);
  });

  it('reports a failure with its error, which carries the app\'s sign-in hint after a rejected token', () => {
    expect(describeSyncOutcome({ kind: 'failed', error: 'Google Drive access expired. Run `labshelf auth login`.', reauth: true })).toMatchObject({
      text: 'Sync failed: Google Drive access expired. Run `labshelf auth login`.', severity: 'error', routine: false, needsSignIn: false,
    });
  });
});
