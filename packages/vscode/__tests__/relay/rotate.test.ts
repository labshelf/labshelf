/** Pins that VS Code rotates and retires the relay under the lifecycle lock: the command, the hourly tick and the start-up pass. */
import * as vscode from 'vscode';
import type { ILogger, RelayAccount, RelayAccountStore } from '@labshelf/core';
import { createRenewingLock, LOCK_RENEW_MS } from '../../src/relay/node/accounts';
import { registerRelay } from '../../src/relay/node/register';
import { RELAY_CHECK_INTERVAL_MS, ROTATE_RELAY_COMMAND } from '../../src/relay/node/rotate';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Manifest { contributes: { commands: { command: string; title: string; category: string }[]; menus: { commandPalette: { command: string }[] } } }
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8')) as Manifest;

// The vscode mock has no CancellationError, which the failure report tests for.
// The relay script is a build-time constant, absent under jest.
jest.mock('@labshelf/core', () => ({ ...jest.requireActual('@labshelf/core'), readRelayWorkerScript: () => 'worker script' }));
jest.mock('vscode', () => ({ ...jest.requireActual('vscode'), CancellationError: class CancellationError extends Error {} }));

const LOCK_SECRET = 'labshelf.relay.lifecycleLock';
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

const current: RelayAccount = {
  credential: { kind: 'token', token: 'token' }, accountId: 'acc', workerName: 'relay-new', relayUrl: 'https://new.example',
  ownerSecret: 'secret', kvNamespaceId: 'kv-new', shareWorker: { name: 'share', url: 'https://share.example', ownerSecret: 's', kvNamespaceId: 'kv-share' },
};
const retiring = (retireAfter: number): RelayAccount => ({
  ...current, retiring: { workerName: 'relay-old', relayUrl: 'https://old.example', ownerSecret: 'o', kvNamespaceId: 'kv-old', retireAfter },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Setup {
  secrets: { get: jest.Mock; store: jest.Mock; delete: jest.Mock };
  save: jest.Mock;
  fetch: jest.Mock;
  context: vscode.ExtensionContext;
  offer: jest.Mock;
  withdraw: jest.Mock;
  open: { value: boolean };
  tick(): Promise<void>;
  /** How many times the lifecycle lock was taken. */
  locks(): number;
  deleted(worker: string): boolean;
}

/** `requests` is what the analytics answer reports; `version` is the status the relay answers its /version probe with. */
function setup(stored: RelayAccount | undefined, options: { requests?: number; version?: number } = {}): Setup {
  const values = new Map<string, string>();
  const secrets = {
    get: jest.fn(async (name: string) => values.get(name)),
    store: jest.fn(async (name: string, value: string) => { values.set(name, value); }),
    delete: jest.fn(async (name: string) => { values.delete(name); }),
  };
  let account = stored;
  const save = jest.fn(async (next: RelayAccount) => { account = next; });
  const accounts = { get: async () => account, save, forget: async () => undefined, tokens: {}, refreshLock: { run: (task: () => Promise<unknown>) => task() } };
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/graphql')) {
      return json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: options.requests ?? 0 } }] }] } } });
    }
    if (init?.method === 'DELETE') { return json({ success: true, result: {} }); }
    if (url.endsWith('/version')) { return new Response('refused', { status: options.version ?? 500 }); }
    return json({ success: false, errors: [{ code: 1, message: 'refused' }] }, 500);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  let hourly: (() => void) | undefined;
  const realSetInterval = globalThis.setInterval;
  spies.push(jest.spyOn(globalThis, 'setInterval').mockImplementation(((handler: () => void, ms?: number) => {
    if (ms === RELAY_CHECK_INTERVAL_MS) { hourly = handler; return 0 as unknown as NodeJS.Timeout; }
    return realSetInterval(handler, ms);
  }) as typeof setInterval));
  const open = { value: true };
  const offer = jest.fn(async () => undefined);
  const withdraw = jest.fn(async () => undefined);
  const context = { subscriptions: [], secrets } as unknown as vscode.ExtensionContext;
  registerRelay(context, {
    accounts: accounts as unknown as RelayAccountStore, logger, offerToShares: offer, withdrawFromShares: withdraw, hasOpenShare: () => open.value,
  });
  return {
    secrets, save, fetch: fetchMock, context, offer, withdraw, open,
    tick: async () => { hourly?.(); await settled(); },
    locks: () => secrets.store.mock.calls.filter(([name]) => name === LOCK_SECRET).length,
    deleted: (worker) => fetchMock.mock.calls.some(([url, init]) => init?.method === 'DELETE' && String(url).includes(`/scripts/${worker}`)),
  };
}

/** Lets the start-up pass and a tick finish: the lock settles for 150 ms before it runs anything. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1200));

function command(id: string): () => Promise<void> {
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([registered]) => registered === id);
  return call![1];
}

const realFetch = globalThis.fetch;
const spies: jest.SpyInstance[] = [];
afterEach(() => { spies.splice(0).forEach((spy) => spy.mockRestore()); globalThis.fetch = realFetch; });

describe('Rotate Relay command (3.4c)', () => {
  it('is declared in package.json and in the command palette, and registered by registerRelay', async () => {
    const declared = manifest.contributes.commands.find((entry) => entry.command === ROTATE_RELAY_COMMAND);
    expect(declared).toMatchObject({ title: 'Rotate Relay', category: 'LabShelf' });
    expect(manifest.contributes.menus.commandPalette.some((entry) => entry.command === ROTATE_RELAY_COMMAND)).toBe(true);
    const run = setup(undefined);
    expect(typeof command(ROTATE_RELAY_COMMAND)).toBe('function');
    await settled();
    expect(run.context.subscriptions.length).toBeGreaterThan(0);
  });
});

describe('rotation under the lifecycle lock (3.4a)', () => {
  it('the command rotates inside the lock: it starts a deploy and reports a failure', async () => {
    const run = setup({ ...current });
    await settled();
    run.secrets.store.mockClear();
    run.fetch.mockClear();
    await command(ROTATE_RELAY_COMMAND)();
    expect(run.locks()).toBe(1);
    expect(run.fetch).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('could not rotate your relay'));
    // The lock is released again.
    expect(await run.secrets.get(LOCK_SECRET)).toBeUndefined();
  });

  it('the command explains that a rotation within the grace period waits', async () => {
    const run = setup(retiring(Date.now() + 3_600_000));
    await settled();
    await command(ROTATE_RELAY_COMMAND)();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('rotated recently'));
    expect(run.fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toHaveLength(0);
  });

  it('the command says so when Cloudflare is not connected', async () => {
    setup(undefined);
    await settled();
    await command(ROTATE_RELAY_COMMAND)();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Cloudflare is not connected.');
  });

  it('the hourly check rotates when the traffic calls for it', async () => {
    const run = setup(retiring(Date.now() + 3_600_000), { requests: 90_000 });
    await settled();
    run.secrets.store.mockClear();
    await run.tick();
    // One for the retirement check, one for the rotation.
    expect(run.locks()).toBe(2);
  });

  it('the hourly check rotates when the relay was refused for the limit, whatever the traffic', async () => {
    const run = setup(retiring(Date.now() + 3_600_000), { requests: 1, version: 429 });
    await settled();
    run.secrets.store.mockClear();
    await run.tick();
    // One for the retirement check, one for the rotation.
    expect(run.locks()).toBe(2);
  });

  it('the hourly check does not rotate when the traffic is low', async () => {
    const run = setup(retiring(Date.now() + 3_600_000), { requests: 10 });
    await settled();
    run.secrets.store.mockClear();
    await run.tick();
    expect(run.fetch.mock.calls.some(([url]) => String(url).includes('/graphql'))).toBe(true);
    expect(run.locks()).toBe(1);
  });

  it('the hourly check does nothing while no share is open', async () => {
    const run = setup(retiring(Date.now() + 3_600_000), { requests: 90_000 });
    await settled();
    run.secrets.store.mockClear();
    run.fetch.mockClear();
    run.open.value = false;
    await run.tick();
    expect(run.fetch).not.toHaveBeenCalled();
    expect(run.locks()).toBe(1);
  });

  it('disposes the hourly timer with the extension', () => {
    const clear = jest.spyOn(globalThis, 'clearInterval');
    spies.push(clear);
    const run = setup(undefined);
    run.context.subscriptions.forEach((entry) => (entry as { dispose(): void }).dispose());
    expect(clear).toHaveBeenCalled();
  });
});

describe('retirement of a rotated-out relay (3.4b)', () => {
  it('start-up deletes the old relay once its retireAfter has passed and drops it from the account', async () => {
    const run = setup(retiring(Date.now() - 1000));
    await settled();
    expect(run.deleted('relay-old')).toBe(true);
    expect(run.save).toHaveBeenCalledWith(expect.not.objectContaining({ retiring: expect.anything() }));
    // The update and the retirement each take the lock.
    expect(run.locks()).toBe(2);
  });

  it('start-up keeps the old relay before its retireAfter', async () => {
    const run = setup(retiring(Date.now() + 3_600_000));
    await settled();
    expect(run.deleted('relay-old')).toBe(false);
    expect(run.save).not.toHaveBeenCalled();
  });

  it('the hourly tick deletes the old relay once its retireAfter has passed, even with no share open', async () => {
    const stored = retiring(Date.now() + 500);
    const run = setup(stored);
    run.open.value = false;
    await settled();
    expect(run.deleted('relay-old')).toBe(false);
    await run.tick();
    expect(run.deleted('relay-old')).toBe(true);
  });

  it('the hourly tick keeps the old relay before its retireAfter', async () => {
    const run = setup(retiring(Date.now() + 3_600_000));
    await settled();
    await run.tick();
    expect(run.deleted('relay-old')).toBe(false);
  });
});

describe('the lifecycle lock stays held through a long change', () => {
  afterEach(() => jest.useRealTimers());

  it('renews its stamp while the task runs and releases the lock at the end', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const values = new Map<string, string>();
    const slot = {
      get: async () => values.get('lock'),
      store: async (value: string) => { values.set('lock', value); },
      delete: async () => { values.delete('lock'); },
    };
    const clock = { now: () => Date.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };
    const done = createRenewingLock(slot, clock)(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 60_000));
      return 'done';
    });
    await jest.advanceTimersByTimeAsync(55_000);
    const stamp = JSON.parse(values.get('lock')!) as { at: number };
    expect(stamp.at - 1_000_000).toBeGreaterThanOrEqual(3 * LOCK_RENEW_MS);
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(done).resolves.toBe('done');
    expect(values.has('lock')).toBe(false);
  });
});
