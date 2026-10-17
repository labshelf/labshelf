// Tests that the settings gear menu offers Drive actions for the connection state and runs the picked command.
import * as vscode from 'vscode';

import { registerSettingsMenu } from '../../../src/activation/registration/registerSettingsMenu';
import type { LibraryRootController } from '../../../src/activation/libraryLifecycle';

function setup(connected: boolean) {
  const controller = {
    currentRoot: () => vscode.Uri.file('/Users/me/Library'),
    syncController: () => ({ isConnected: () => connected }),
  } as unknown as LibraryRootController;
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerSettingsMenu(context, controller);
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([id]) => id === 'labshelf.settingsMenu');
  return call[1] as () => Promise<void>;
}

const offered = () => ((vscode.window.showQuickPick as jest.Mock).mock.calls.at(-1)[0] as { command: string }[]).map((c) => c.command);

describe('registerSettingsMenu', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers connecting when Drive is disconnected', async () => {
    await setup(false)();
    expect(offered()).toEqual(['labshelf.configureLibrary', 'labshelf.sync.connect', 'labshelf.openSettings', 'labshelf.ai.openSettings']);
  });

  it('offers sync and disconnect when Drive is connected, and runs the picked command', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: { command: string }[]) => items[1]);
    await setup(true)();
    expect(offered()).toContain('labshelf.sync.disconnect');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.sync.now');
  });
});
