/** Pins the VS Code stores behind invitations by email: the identity in SecretStorage, contacts and the switch in global state. */
import type * as vscode from 'vscode';
import type { IdentityJwk, InvitationPorts } from '@labshelf/core';
import { createInvitationPorts } from '../../../src/collab/node/identity';

function secrets(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const storage = {
    get: jest.fn(async (key: string) => values.get(key)),
    store: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: jest.fn(async (key: string) => { values.delete(key); }),
  };
  return { storage: storage as unknown as vscode.SecretStorage, values, ...storage };
}

function memento(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const state = {
    get: jest.fn((key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback)),
    update: jest.fn(async (key: string, value: unknown) => { values.set(key, value); }),
  };
  return { state: state as unknown as vscode.Memento, values };
}

type Contact = Awaited<ReturnType<InvitationPorts['contacts']['read']>>[number];

const pair = { privateKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' }, publicKey: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } };
const jwk: IdentityJwk = { encryption: pair, signing: pair };
const contact: Contact = {
  name: 'Ada', email: 'ada@example.com', inboxUrl: 'https://relay.example', inboxToken: 'tok', encryptionKey: 'e', signingKey: 's', updated: 1, fingerprint: 'f',
};

function build(initialSecrets: Record<string, string> = {}, initialState: Record<string, unknown> = {}) {
  const s = secrets(initialSecrets);
  const m = memento(initialState);
  const ports = createInvitationPorts({ secrets: s.storage, state: m.state, libraryId: async () => 'lib1', accessToken: async () => 'cf-token' });
  return { ports, s, m };
}

describe('createInvitationPorts', () => {
  it('keeps the identity in SecretStorage under the library id and reads it back after a restart', async () => {
    const first = build();
    expect(await first.ports.identity.load()).toBeUndefined();
    await first.ports.identity.save(jwk);
    expect(JSON.parse(first.s.values.get('labshelf.collab.identity.lib1')!)).toEqual(jwk);
    const restarted = build(Object.fromEntries(first.s.values));
    expect(await restarted.ports.identity.load()).toEqual(jwk);
  });

  it('reads a malformed identity as absent', async () => {
    expect(await build({ 'labshelf.collab.identity.lib1': 'not json' }).ports.identity.load()).toBeUndefined();
    expect(await build({ 'labshelf.collab.identity.lib1': JSON.stringify({ encryption: {} }) }).ports.identity.load()).toBeUndefined();
  });

  it('leaves the invite secrets alone', async () => {
    const { ports, s } = build({ 'labshelf.collab.invite.share1': 'link' });
    await ports.identity.save(jwk);
    expect(s.values.get('labshelf.collab.invite.share1')).toBe('link');
    expect(s.delete).not.toHaveBeenCalled();
  });

  it('keeps contacts and the switch in global state, per library, off by default', async () => {
    const { ports, m } = build();
    expect(await ports.contacts.read()).toEqual([]);
    expect(await ports.enabled.get()).toBe(false);
    await ports.contacts.write([contact]);
    await ports.enabled.set(true);
    expect(m.values.get('labshelf.collab.contacts.lib1')).toEqual([contact]);
    expect(m.values.get('labshelf.collab.invitationsEnabled.lib1')).toBe(true);
    const restarted = build({}, Object.fromEntries(m.values));
    expect(await restarted.ports.contacts.read()).toEqual([contact]);
    expect(await restarted.ports.enabled.get()).toBe(true);
  });

  it('reads malformed contacts and a non-boolean switch as absent', async () => {
    const { ports } = build({}, { 'labshelf.collab.contacts.lib1': [{ name: 1 }], 'labshelf.collab.invitationsEnabled.lib1': 'yes' });
    expect(await ports.contacts.read()).toEqual([]);
    expect(await ports.enabled.get()).toBe(false);
  });

  it('keeps email pins in global state per library and reads a malformed record as absent', async () => {
    const pin = { email: 'ada@example.com', fingerprint: 'f', encryptionKey: 'e', signingKey: 's', pinned: 1 };
    const { ports, m } = build();
    expect(await ports.emailPins!.read()).toEqual([]);
    await ports.emailPins!.write([pin]);
    expect(m.values.get('labshelf.collab.emailPins.lib1')).toEqual([pin]);
    expect(await build({}, Object.fromEntries(m.values)).ports.emailPins!.read()).toEqual([pin]);
    expect(await build({}, { 'labshelf.collab.emailPins.lib1': [{ email: 1 }] }).ports.emailPins!.read()).toEqual([]);
  });

  it('takes the access token from the given reader', async () => {
    expect(await build().ports.accessToken()).toBe('cf-token');
  });
});
