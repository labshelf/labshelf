/** The VS Code sharing host speaks library paths to the dialogs and disk paths to the core folder-link operations. */
import * as path from 'node:path';
import type { ILogger, ShareHost } from '@labshelf/core';
import * as vscode from 'vscode';
import { serveShareOn, withLibraryPaths } from '../../../src/share/node/host';
import { createLibraryPaths } from '../../../src/libraryUi/paths';

const root = '/lib/papers';

function host() {
  const inner = {
    shareableFolder: jest.fn(async (dir: string) => ({ path: dir, label: 'ML', count: 2 })),
    shareFolder: jest.fn(async () => ({ kind: 'shared' as const, link: 'https://x' })),
    openFolder: jest.fn(async () => undefined),
    importLink: jest.fn(async () => ({ kind: 'imported' as const, summary: 'Added 1', folder: '/lib/papers/Shared' })),
    sharedLinks: jest.fn(async () => [
      { id: 'a', folder: '/lib/papers/ML/2024', link: 'l', createdAt: 't', relayHost: 'h' },
      { id: 'b', folder: '/elsewhere/X', link: 'l', createdAt: 't', relayHost: 'h' },
    ]),
  };
  return { inner, wrapped: withLibraryPaths(inner as unknown as ShareHost, () => createLibraryPaths(root, path.posix)) };
}

describe('withLibraryPaths', () => {
  it('maps library paths to disk paths on the way in and back on the way out', async () => {
    const { inner, wrapped } = host();
    expect(await wrapped.shareableFolder('papers/ML')).toEqual({ path: 'papers/ML', label: 'ML', count: 2 });
    expect(inner.shareableFolder).toHaveBeenCalledWith('/lib/papers/ML');
    const onProgress = jest.fn();
    await wrapped.shareFolder('papers/ML/2024', true, onProgress);
    expect(inner.shareFolder).toHaveBeenCalledWith('/lib/papers/ML/2024', true, onProgress);
    await wrapped.openFolder('papers');
    expect(inner.openFolder).toHaveBeenCalledWith(root);
    expect(await wrapped.importLink('link', onProgress)).toEqual({ kind: 'imported', summary: 'Added 1', folder: 'papers/Shared' });
    expect((await wrapped.sharedLinks()).map((link) => link.folder)).toEqual(['papers/ML/2024', '/elsewhere/X']);
  });

  it('rejects a path that does not map into the library', async () => {
    const { inner, wrapped } = host();
    await expect(wrapped.shareFolder('papers/../secrets', false, jest.fn())).rejects.toThrow('outside the library');
    await expect(wrapped.openFolder('research/x')).rejects.toThrow('outside the library');
    await expect(wrapped.shareableFolder('/etc')).rejects.toThrow('outside the library');
    expect(inner.shareFolder).not.toHaveBeenCalled();
    expect(inner.openFolder).not.toHaveBeenCalled();
    expect(inner.shareableFolder).not.toHaveBeenCalled();
  });
});

const invitation = { id: 'i1', title: 'ML', from: { fingerprint: 'f' }, created: 1, expires: 2 };

describe('invitations over the VS Code sharing host', () => {
  it('forwards every invitation op through withLibraryPaths untouched', async () => {
    const inner = {
      shareableFolder: jest.fn(), shareFolder: jest.fn(), openFolder: jest.fn(), importLink: jest.fn(), sharedLinks: jest.fn(),
      invitations: jest.fn(async () => [invitation]),
      onInvitationsChange: jest.fn(() => () => undefined),
      acceptInvitation: jest.fn(async () => ({ kind: 'joined' as const, id: 'p', name: 'ML' })),
      declineInvitation: jest.fn(async () => undefined),
      inviteByEmail: jest.fn(async () => ({ sent: 'direct' as const })),
      contacts: jest.fn(async () => []),
      invitationsEnabled: jest.fn(async () => true),
      setInvitationsEnabled: jest.fn(async () => undefined),
    };
    const wrapped = withLibraryPaths(inner as unknown as ShareHost, () => createLibraryPaths(root, path.posix));
    const signal = new AbortController().signal;
    expect(await wrapped.invitations()).toEqual([invitation]);
    expect(await wrapped.acceptInvitation('i1', signal)).toEqual({ kind: 'joined', id: 'p', name: 'ML' });
    await wrapped.declineInvitation('i1');
    expect(await wrapped.inviteByEmail('papers/ML', 'a@b.c')).toEqual({ sent: 'direct' });
    expect(inner.inviteByEmail).toHaveBeenCalledWith('papers/ML', 'a@b.c');
    expect(await wrapped.contacts()).toEqual([]);
    expect(await wrapped.invitationsEnabled()).toBe(true);
    await wrapped.setInvitationsEnabled(true);
    expect(inner.setInvitationsEnabled).toHaveBeenCalledWith(true);
    expect(wrapped.onInvitationsChange).toBe(inner.onInvitationsChange);
  });

  it('serves the new ops and pushes invitation changes to the webview', async () => {
    let change: ((list: unknown[]) => void) | undefined;
    const host = {
      offers: () => ({ projects: true, links: true }), place: 'this device', onOffersChange: () => () => undefined,
      onInvitationsChange: (listener: (list: unknown[]) => void) => { change = listener; return () => undefined; },
      invitations: jest.fn(async () => [invitation]),
      invitationsEnabled: jest.fn(async () => true),
    };
    let receive: ((raw: unknown) => void) | undefined;
    const webview = {
      postMessage: jest.fn(async () => true),
      onDidReceiveMessage: (listener: (raw: unknown) => void) => { receive = listener; return new vscode.Disposable(() => undefined); },
    };
    const logger = { log: jest.fn(), error: jest.fn() } as unknown as ILogger;
    serveShareOn(webview as unknown as vscode.Webview, host as unknown as ShareHost, logger);
    receive!({ channel: 'sharing', type: 'call', id: 1, op: 'invitations', args: [] });
    receive!({ channel: 'sharing', type: 'call', id: 2, op: 'invitationsEnabled', args: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(webview.postMessage).toHaveBeenCalledWith({ channel: 'sharing', type: 'result', id: 1, ok: true, value: [invitation] });
    expect(webview.postMessage).toHaveBeenCalledWith({ channel: 'sharing', type: 'result', id: 2, ok: true, value: true });
    change!([invitation]);
    expect(webview.postMessage).toHaveBeenCalledWith({ channel: 'sharing', type: 'invitations', invitations: [invitation] });
  });
});
