/** Pins that a rotation started in VS Code moves the directory registration and the cards through the app's updateRegistration. */
import * as vscode from 'vscode';
import type { ILogger, RelayAccountStore, RotateRelayDeps } from '@labshelf/core';
import { registerRotation, ROTATE_RELAY_COMMAND, type RotateDeps } from '../../src/relay/node/rotate';

const rotateRelay = jest.fn(async (_deps: RotateRelayDeps) => undefined);
jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'),
  readRelayWorkerScript: () => 'worker script',
  rotateRelay: (deps: RotateRelayDeps) => rotateRelay(deps),
}));
jest.mock('vscode', () => ({ ...jest.requireActual('vscode'), CancellationError: class CancellationError extends Error {} }));

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

function register(extra: Partial<RotateDeps>): () => Promise<void> {
  const deps: RotateDeps = {
    accounts: {} as RelayAccountStore, logger, offerToShares: async () => undefined, withdrawFromShares: async () => undefined,
    withLock: (run) => run(), hasOpenShare: () => false, ...extra,
  };
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerRotation(context, deps);
  context.subscriptions.forEach((entry) => (entry as { dispose(): void }).dispose());
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.filter(([id]) => id === ROTATE_RELAY_COMMAND).at(-1);
  return call![1];
}

describe('Rotate Relay registration update', () => {
  beforeEach(() => rotateRelay.mockClear());

  it('hands updateRegistration to the rotation', async () => {
    const updateRegistration = jest.fn(async () => undefined);
    await register({ updateRegistration })();
    expect(rotateRelay).toHaveBeenCalledTimes(1);
    expect(rotateRelay.mock.calls[0]![0].updateRegistration).toBe(updateRegistration);
  });

  it('rotates without one when the app gives none', async () => {
    await register({})();
    expect(rotateRelay.mock.calls[0]![0].updateRegistration).toBeUndefined();
  });
});
