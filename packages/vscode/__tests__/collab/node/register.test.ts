/** Pins that the share workflow's relay prompt reports the Connect Cloudflare outcome, not the stored account. */
import * as vscode from 'vscode';
import type { ILogger, Invitations, RelayAccountStore } from '@labshelf/core';
import { createCapturedInvitationPorts, createCollabPorts, createLibraryInvitations, type CollabPortsDeps } from '../../../src/collab/node/register';
import { createInvitationPorts } from '../../../src/collab/node/identity';

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

function ports(stored: unknown) {
  const relay = { get: jest.fn(async () => stored) } as unknown as RelayAccountStore;
  const deps = { secrets: {}, libraryRoot: () => '/lib', logger, projects: {}, shares: {}, editors: {}, relay } as unknown as CollabPortsDeps;
  return createCollabPorts(deps);
}

describe('createCollabPorts requireRelay', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports a cancelled prompt as no relay, even when an account was stored meanwhile', async () => {
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce(false);
    await expect(ports({ relayUrl: 'https://relay.example' }).requireRelay()).resolves.toBe(false);
  });

  it('reports a completed connection as a relay', async () => {
    (vscode.commands.executeCommand as jest.Mock).mockResolvedValueOnce(true);
    await expect(ports(undefined).requireRelay()).resolves.toBe(true);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.relay.connect');
  });
});

jest.mock('@labshelf/core/node', () => ({
  ...jest.requireActual('@labshelf/core/node'),
  createDeviceLocalLayout: (root: string) => ({ root }),
  createDeviceIdentity: (layout: { root: string }) => ({ id: async () => `id-of${layout.root.replace(/\//g, '-')}` }),
}));

function capturedPorts(stored: unknown, libraryRoot: () => string | undefined, state: vscode.Memento) {
  const relay = { get: jest.fn(async () => stored) } as unknown as RelayAccountStore;
  return createCapturedInvitationPorts({ secrets: {}, state, libraryRoot, logger, projects: {}, shares: {}, editors: {}, relay } as unknown as CollabPortsDeps);
}

describe('createCapturedInvitationPorts', () => {
  it('names the user to the directory by the stored account token, and throws without an account', async () => {
    const credential = { kind: 'token', token: 'cf-api-token' };
    const state = { get: jest.fn(), update: jest.fn() } as unknown as vscode.Memento;
    await expect(capturedPorts({ credential, relayUrl: 'https://relay.example' }, () => '/lib', state).accessToken()).resolves.toBe('cf-api-token');
    await expect(capturedPorts(undefined, () => '/lib', state).accessToken()).rejects.toThrow('not connected');
  });

  it('keeps the stores of the library open when it was made, after a change of library', async () => {
    const values = new Map<string, unknown>();
    const state = { get: jest.fn((key: string) => values.get(key)), update: jest.fn(async (key: string, value: unknown) => { values.set(key, value); }) } as unknown as vscode.Memento;
    let root: string | undefined = '/lib-a';
    const first = capturedPorts(undefined, () => root, state);
    root = '/lib-b';
    const second = capturedPorts(undefined, () => root, state);
    await first.enabled.set(true);
    expect([...values.keys()]).toEqual(['labshelf.collab.invitationsEnabled.id-of-lib-a']);
    await second.enabled.set(true);
    expect([...values.keys()]).toEqual(['labshelf.collab.invitationsEnabled.id-of-lib-a', 'labshelf.collab.invitationsEnabled.id-of-lib-b']);
  });

  it('refuses every store while no library was open', async () => {
    const state = { get: jest.fn(), update: jest.fn() } as unknown as vscode.Memento;
    await expect(capturedPorts(undefined, () => undefined, state).enabled.get()).rejects.toThrow('no library is open');
  });
});

describe('createLibraryInvitations', () => {
  const view = (id: string) => ({ id, title: 'Paper', created: 1, expires: 2, from: { fingerprint: 'fp' } });

  /** Invitations over the real stores of a library, which hold the list read from "its" inbox. */
  function world() {
    const secrets = new Map<string, string>([['labshelf.collab.identity.lib-a', '{"a":1}'], ['labshelf.collab.identity.lib-b', '{"b":2}']]);
    const reads: string[] = [];
    const secretStorage = { get: jest.fn(async (key: string) => { reads.push(key); return secrets.get(key); }), store: jest.fn() } as unknown as vscode.SecretStorage;
    const state = { get: jest.fn(), update: jest.fn() } as unknown as vscode.Memento;
    let root: string | undefined = '/lib-a';
    const libraryId = async () => (root === '/lib-a' ? 'lib-a' : 'lib-b');
    const stores = createInvitationPorts({ secrets: secretStorage, state, libraryId, accessToken: async () => 'token' });
    const created: string[] = [];
    const inboxes: Record<string, string[]> = { '/lib-a': ['a1', 'a2'], '/lib-b': [] };
    const create = (): Invitations => {
      const own = root!;
      created.push(own);
      let held: Array<ReturnType<typeof view>> = [];
      const listeners = new Set<(list: Array<ReturnType<typeof view>>) => void>();
      const stub = {
        invitations: async () => held,
        refreshInvitations: async () => {
          await stores.identity.load();
          held = inboxes[own]!.map(view);
          listeners.forEach((listener) => listener(held));
          return held;
        },
        onInvitationsChange: (listener: (list: Array<ReturnType<typeof view>>) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      };
      return stub as unknown as Invitations;
    };
    return { create, created, reads, setRoot: (next: string | undefined) => { root = next; }, getRoot: () => root };
  }

  it('drops the previous library\'s held list and reads the new library\'s identity after a library change', async () => {
    const w = world();
    const invitations = createLibraryInvitations(w.getRoot, w.create);
    await invitations.refreshInvitations();
    expect((await invitations.invitations()).map((entry) => entry.id)).toEqual(['a1', 'a2']);
    expect(w.reads).toEqual(['labshelf.collab.identity.lib-a']);
    w.setRoot('/lib-b');
    await expect(invitations.invitations()).resolves.toEqual([]);
    await invitations.refreshInvitations();
    expect(w.reads).toEqual(['labshelf.collab.identity.lib-a', 'labshelf.collab.identity.lib-b']);
    expect(w.created).toEqual(['/lib-a', '/lib-b']);
  });

  it('keeps one instance while the library stays the same, and keeps listeners across a change', async () => {
    const w = world();
    const invitations = createLibraryInvitations(w.getRoot, w.create);
    const seen: string[][] = [];
    invitations.onInvitationsChange((list) => seen.push(list.map((entry) => entry.id)));
    await invitations.refreshInvitations();
    await invitations.invitations();
    expect(w.created).toEqual(['/lib-a']);
    w.setRoot('/lib-b');
    await invitations.invitations();
    expect(seen).toEqual([['a1', 'a2'], []]);
    await invitations.refreshInvitations();
    expect(w.created).toEqual(['/lib-a', '/lib-b']);
  });
});
