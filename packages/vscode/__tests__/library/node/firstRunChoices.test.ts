import { firstRunChoices } from '../../../src/library/node/firstRunChoices';

describe('firstRunChoices', () => {
  it('lists a LabShelf folder per sync folder, then the local one, then the two escape hatches', () => {
    const choices = firstRunChoices(
      [{ tool: 'dropbox', path: '/home/me/Dropbox' }, { tool: 'syncthing', path: '/home/me/Sync' }],
      '/home/me',
    );

    expect(choices).toEqual([
      { kind: 'folder', path: '/home/me/Dropbox/LabShelf', label: '~/Dropbox/LabShelf', detail: 'synced by Dropbox' },
      { kind: 'folder', path: '/home/me/Sync/LabShelf', label: '~/Sync/LabShelf', detail: 'synced by Syncthing' },
      { kind: 'folder', path: '/home/me/LabShelf', label: '~/LabShelf', detail: 'only on this computer' },
      { kind: 'browse', label: 'Choose a folder…' },
      { kind: 'guide', label: 'How to sync between computers…' },
    ]);
  });

  it('offers the local folder, a browse and the guide when nothing is detected', () => {
    expect(firstRunChoices([], '/home/me').map((choice) => choice.kind)).toEqual(['folder', 'browse', 'guide']);
  });

  it('shows the full path for a sync folder outside the home folder', () => {
    const [choice] = firstRunChoices([{ tool: 'onedrive', path: '/mnt/OneDrive' }], '/home/me');
    expect(choice?.label).toBe('/mnt/OneDrive/LabShelf');
  });
});
