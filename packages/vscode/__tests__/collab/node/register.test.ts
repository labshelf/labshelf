/** Pins that the share workflow's relay prompt reports the Connect Cloudflare outcome, not the stored account. */
import * as vscode from 'vscode';
import type { ILogger, RelayAccountStore } from '@labshelf/core';
import { createCollabPorts, type CollabPortsDeps } from '../../../src/collab/node/register';

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
