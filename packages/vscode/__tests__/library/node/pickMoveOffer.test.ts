import { pickMoveOffer } from '../../../src/library/node/pickMoveOffer';

const dropbox = { tool: 'dropbox', path: '/home/me/Dropbox' } as const;
const nextcloud = { tool: 'nextcloud', path: '/home/me/Nextcloud' } as const;

describe('pickMoveOffer', () => {
  it('offers the first detected folder for a local library', () => {
    expect(pickMoveOffer('/home/me/LabShelf', [dropbox, nextcloud], [], new Set())).toBe(dropbox);
  });

  it('offers nothing when the library is already inside a sync folder', () => {
    expect(pickMoveOffer('/home/me/Dropbox/LabShelf', [dropbox, nextcloud], [], new Set())).toBeUndefined();
  });

  it('does not mistake a sibling folder with a shared name prefix for a sync folder', () => {
    expect(pickMoveOffer('/home/me/Dropbox2/LabShelf', [dropbox], [], new Set())).toBe(dropbox);
  });

  it('skips a tool whose LabShelf folder already exists', () => {
    const taken = new Set(['/home/me/Dropbox/LabShelf']);
    expect(pickMoveOffer('/home/me/LabShelf', [dropbox, nextcloud], [], taken)).toBe(nextcloud);
  });

  it('skips a dismissed tool and offers nothing when all are dismissed', () => {
    expect(pickMoveOffer('/home/me/LabShelf', [dropbox, nextcloud], ['dropbox'], new Set())).toBe(nextcloud);
    expect(pickMoveOffer('/home/me/LabShelf', [dropbox], ['dropbox'], new Set())).toBeUndefined();
  });
});
