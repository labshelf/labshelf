// Tests that the Settings view header shows the open library folder and follows root changes.
import * as vscode from 'vscode';

import { registerSettingsWelcomeView } from '../../../src/activation/registration/registerSettingsWelcomeView';
import type { LibraryRootController } from '../../../src/activation/libraryLifecycle';

describe('registerSettingsWelcomeView', () => {
  it('shows the current library folder in the view header and updates it when the root changes', () => {
    const view: { description?: string; dispose: () => void } = { dispose: () => {} };
    (vscode.window.createTreeView as jest.Mock).mockReturnValueOnce(view);
    const emitter = new vscode.EventEmitter<{ root: vscode.Uri }>();
    const controller = {
      currentRoot: () => vscode.Uri.file('/Users/me/Library'),
      onDidChangeRoot: emitter.event,
    } as unknown as LibraryRootController;

    registerSettingsWelcomeView({ subscriptions: [] } as unknown as vscode.ExtensionContext, controller);
    expect(view.description).toBe('/Users/me/Library');

    emitter.fire({ root: vscode.Uri.file('/Users/me/Other') });
    expect(view.description).toBe('/Users/me/Other');
  });
});
