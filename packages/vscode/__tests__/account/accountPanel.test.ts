/** Pins the one VS Code user name: the store behind the Account tab, and presence reading it live. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ShareConnection } from '@labshelf/core';
import { createUserNameStore } from '../../src/account/accountPanel';
import { SharedPresence, type SharedEditors } from '../../src/collab/node/editors';

const KEY = 'labshelf.account.userName';

function memento(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const state = {
    get: jest.fn((key: string, fallback?: unknown) => (values.has(key) ? values.get(key) : fallback)),
    update: jest.fn(async (key: string, value: unknown) => { values.set(key, value); }),
  };
  return { state: state as unknown as vscode.Memento, values };
}

describe('createUserNameStore', () => {
  it('7.2a answers the fallback while no name is saved', () => {
    const { state } = memento();
    expect(createUserNameStore(state, () => 'os-user').read()).toBe('os-user');
  });

  it('7.2a answers the trimmed saved name after a save, and keeps it in global state', async () => {
    const { state, values } = memento();
    const store = createUserNameStore(state, () => 'os-user');
    await store.write('  Ada Lovelace \n');
    expect(store.read()).toBe('Ada Lovelace');
    expect(values.get(KEY)).toBe('Ada Lovelace');
  });

  it('7.2a reads a saved name back after a restart', async () => {
    const first = memento();
    await createUserNameStore(first.state, () => 'os-user').write('Ada');
    const restarted = memento(Object.fromEntries(first.values));
    expect(createUserNameStore(restarted.state, () => 'os-user').read()).toBe('Ada');
  });

  it('7.2a falls back again after a blank save', async () => {
    const { state } = memento();
    const store = createUserNameStore(state, () => 'os-user');
    await store.write('Ada');
    await store.write('');
    expect(store.read()).toBe('os-user');
  });

  it('7.2a falls back after a whitespace-only save', async () => {
    const { state } = memento();
    const store = createUserNameStore(state, () => 'os-user');
    await store.write('Ada');
    await store.write('   \t ');
    expect(store.read()).toBe('os-user');
  });

  it('7.2a counts a whitespace-only name already in global state as unset', () => {
    const { state } = memento({ [KEY]: '   ' });
    expect(createUserNameStore(state, () => 'os-user').read()).toBe('os-user');
  });

  it('7.2a asks the fallback each time, so it follows the OS user name', () => {
    const { state } = memento();
    let current = 'first';
    const store = createUserNameStore(state, () => current);
    expect(store.read()).toBe('first');
    current = 'second';
    expect(store.read()).toBe('second');
  });

  it('7.2a fires onDidChange with the trimmed name after a save', async () => {
    const { state } = memento();
    const store = createUserNameStore(state, () => 'os-user');
    const seen: string[] = [];
    store.onDidChange((name) => seen.push(name));
    await store.write('  Grace ');
    expect(seen).toEqual(['Grace']);
  });

  it('7.2a stops calling a listener once it is disposed', async () => {
    const { state } = memento();
    const store = createUserNameStore(state, () => 'os-user');
    const seen: string[] = [];
    const subscription = store.onDidChange((name) => seen.push(name));
    subscription.dispose();
    await store.write('Grace');
    expect(seen).toEqual([]);
  });
});

describe('SharedPresence', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  function build(getName: () => string) {
    const setLocal = jest.fn();
    const share = {
      presence: {
        awareness: { clientID: 7, on: jest.fn(), off: jest.fn() },
        setLocal,
        remote: () => new Map(),
      },
    } as unknown as ShareConnection;
    const editors = { of: () => undefined, onDidChange: new vscode.EventEmitter<void>().event } as unknown as SharedEditors;
    const presence = new SharedPresence(editors, () => [share], getName);
    return { presence, share, setLocal };
  }

  const lastName = (setLocal: jest.Mock): unknown => (setLocal.mock.calls.at(-1)?.[0] as { name: string }).name;

  it('7.2b publishes the name it has at the time of the publish', () => {
    const { presence, share, setLocal } = build(() => 'Ada');
    presence.watch(share);
    jest.advanceTimersByTime(1000);
    expect(lastName(setLocal)).toBe('Ada');
    presence.dispose();
  });

  it('7.2b publishes the new name after a rename without recreating the presence', () => {
    let name = 'Ada';
    const { presence, share, setLocal } = build(() => name);
    presence.watch(share);
    jest.advanceTimersByTime(1000);
    name = 'Grace';
    (vscode.window as unknown as { _fireActiveEditorChange(): void })._fireActiveEditorChange();
    jest.advanceTimersByTime(1000);
    expect(setLocal).toHaveBeenCalledTimes(2);
    expect(lastName(setLocal)).toBe('Grace');
    presence.dispose();
  });
});

describe('Account source files', () => {
  it('7.2c leave no "// MOCK:" comment in packages/vscode/src/account', () => {
    const root = path.resolve(__dirname, '../../src/account');
    const files = (fs.readdirSync(root, { recursive: true }) as string[]).map((entry) => path.join(root, entry)).filter((file) => fs.statSync(file).isFile());
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((file) => fs.readFileSync(file, 'utf8').includes('// MOCK:'));
    expect(offenders).toEqual([]);
  });
});
