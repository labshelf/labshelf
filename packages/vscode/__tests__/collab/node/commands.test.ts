/** The collab commands: the project dialog commands and the share status bar item. */
import * as vscode from 'vscode';
import { sharingWebviews } from '../../../src/share/index';
import { registerProjectDialogCommands, registerShareStatusBar } from '../../../src/collab/node/commands';
import type { CollabHost } from '../../../src/collab/node/commands';

jest.mock('../../../src/share/webviews', () => ({ sharingWebviews: { open: jest.fn(async () => undefined) } }));

describe('projectDialogCommands', () => {
  function commandHandler(id: string): (...args: unknown[]) => Promise<void> {
    const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id);
    return call[1];
  }

  describe('registerProjectDialogCommands', () => {
    beforeEach(() => jest.clearAllMocks());

    it('sends the folder of a project entry or a folder path as the project id', async () => {
      registerProjectDialogCommands(async () => '/lib');
      await commandHandler('labshelf.collab.share')({ kind: 'ready', folder: '/lib/projects/thesis' });
      await commandHandler('labshelf.collab.leave')('/lib/projects/thesis');
      await commandHandler('labshelf.collab.join')('labshelf-invite');
      await commandHandler('labshelf.collab.share')(vscode.Uri.file('/elsewhere'));
      expect((sharingWebviews.open as jest.Mock).mock.calls).toEqual([
        [{ kind: 'shareProject', projectId: '/lib/projects/thesis' }],
        [{ kind: 'leaveProject', projectId: '/lib/projects/thesis' }],
        [{ kind: 'joinProject', invite: 'labshelf-invite' }],
        [{ kind: 'shareProject' }],
      ]);
    });

    it('opens nothing when no library is open', async () => {
      registerProjectDialogCommands(async () => undefined);
      await commandHandler('labshelf.collab.join')();
      expect(sharingWebviews.open).not.toHaveBeenCalled();
    });
  });
});

describe('shareStatusBar', () => {
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
});
