import type * as vscode from 'vscode';

import { SecretStorageTokenStore } from '../../../src/sync/auth/secretStorageTokenStore';

function memorySecrets(): { secrets: vscode.SecretStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => { values.set(key, value); },
    delete: async (key: string) => { values.delete(key); },
  } as unknown as vscode.SecretStorage;
  return { secrets, values };
}

const TOKENS = { access_token: 'access-1', refresh_token: 'refresh-1', expiry_ms: 1_800_000_000_000 };

describe('SecretStorageTokenStore', () => {
  it('is of kind secret-storage', () => {
    expect(new SecretStorageTokenStore(memorySecrets().secrets).kind).toBe('secret-storage');
  });

  it('saves the tokens as JSON under labshelf.gdrive.tokens, the key signed-in users already have', async () => {
    const { secrets, values } = memorySecrets();
    await new SecretStorageTokenStore(secrets).save(TOKENS);
    expect(JSON.parse(values.get('labshelf.gdrive.tokens')!)).toEqual(TOKENS);
  });

  it('loads tokens written by an earlier version of the extension', async () => {
    const { secrets, values } = memorySecrets();
    values.set('labshelf.gdrive.tokens', JSON.stringify(TOKENS));
    expect(await new SecretStorageTokenStore(secrets).load()).toEqual(TOKENS);
  });

  it('loads null when nothing is stored or the stored value is not a token record', async () => {
    const { secrets, values } = memorySecrets();
    const store = new SecretStorageTokenStore(secrets);
    expect(await store.load()).toBeNull();
    values.set('labshelf.gdrive.tokens', '{ broken');
    expect(await store.load()).toBeNull();
  });

  it('clears the stored tokens', async () => {
    const { secrets, values } = memorySecrets();
    const store = new SecretStorageTokenStore(secrets);
    await store.save(TOKENS);
    await store.clear();
    expect(values.has('labshelf.gdrive.tokens')).toBe(false);
    expect(await store.load()).toBeNull();
  });
});
