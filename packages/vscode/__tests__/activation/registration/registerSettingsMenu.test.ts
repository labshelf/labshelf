// Tests that the settings gear menu lists its entries and runs the picked command.
import * as vscode from 'vscode';

import { registerSettingsMenu } from '../../../src/activation/registration/registerSettingsMenu';
import type { LibraryRootController } from '../../../src/activation/libraryLifecycle';

function setup() {
  const controller = { currentRoot: () => vscode.Uri.file('/Users/me/Library') } as unknown as LibraryRootController;
  const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
  registerSettingsMenu(context, controller);
  const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([id]) => id === 'labshelf.settingsMenu');
  return call[1] as () => Promise<void>;
}

const offered = () => ((vscode.window.showQuickPick as jest.Mock).mock.calls.at(-1)[0] as { command: string }[]).map((c) => c.command);

describe('registerSettingsMenu', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers the library folder, settings and AI settings', async () => {
    await setup()();
    expect(offered()).toEqual(['labshelf.configureLibrary', 'labshelf.openSettings', 'labshelf.ai.openSettings']);
  });

  it('runs the picked command', async () => {
    (vscode.window.showQuickPick as jest.Mock).mockImplementationOnce(async (items: { command: string }[]) => items[1]);
    await setup()();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.openSettings');
  });
});
