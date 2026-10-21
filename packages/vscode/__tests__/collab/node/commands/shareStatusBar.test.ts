/** The share status bar item shows a share's problem while it lasts. */
import * as vscode from 'vscode';
import { registerShareStatusBar } from '../../../../src/collab/node/commands/shareStatusBar';
import type { CollabHost } from '../../../../src/collab/node/collabHost';

jest.mock('../../../../src/sharing/index', () => ({ sharingWebviews: { open: jest.fn(async () => undefined) } }));

function setup() {
  let failure: string | undefined = 'QuotaExceededError';
  const listeners: Array<() => void> = [];
  const share = {
    shareId: 's1', folder: '/lib/thesis', session: { status: 'open', peers: [] }, relays: { list: () => [], current: undefined },
    state: () => ({ status: 'open', relay: undefined, persistenceFailure: failure, mirror: { kind: 'running' } }),
  };
  const host = {
    shares: { list: () => [share], onDidChange: (listener: () => void) => { listeners.push(listener); return { dispose() {} }; } },
    editors: { of: () => undefined },
  } as unknown as CollabHost;
  registerShareStatusBar({ subscriptions: [] } as unknown as vscode.ExtensionContext, host);
  const item = (vscode.window.createStatusBarItem as jest.Mock).mock.results.at(-1)?.value;
  return { item, clear: () => { failure = undefined; listeners.forEach((listener) => listener()); } };
}

describe('registerShareStatusBar', () => {
  it('marks the item with an error and gives the problem in its tooltip', () => {
    const { item } = setup();
    expect(item.backgroundColor).toBeInstanceOf(vscode.ThemeColor);
    expect(item.tooltip).toContain('QuotaExceededError');
  });

  it('drops the mark once the problem clears', () => {
    const { item, clear } = setup();
    clear();
    expect(item.backgroundColor).toBeUndefined();
    expect(item.tooltip).not.toContain('QuotaExceededError');
  });
});
