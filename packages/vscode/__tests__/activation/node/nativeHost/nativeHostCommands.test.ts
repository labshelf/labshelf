// Tests that the native-host commands install with the extension's own launch and that activation refreshes both launchers safely.
import * as vscode from 'vscode';

import { HELPER_HOST_SPEC, BRIDGE_HOST_SPEC, installNativeHost, refreshNativeHost } from '@labshelf/core/nativeHost/node';
import { registerNativeHostCommands } from '../../../../src/activation/node/nativeHost';

jest.mock('@labshelf/core/nativeHost/node', () => ({
  ...jest.requireActual('@labshelf/core/nativeHost/node'),
  installNativeHost: jest.fn(),
  refreshNativeHost: jest.fn(),
  systemNativeHostEnv: jest.fn((logger: unknown) => ({ logger })),
}));

const install = installNativeHost as jest.Mock;
const refresh = refreshNativeHost as jest.Mock;
const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const adapters = { createLogger: jest.fn(() => logger) } as never;
const context = { extensionPath: '/ext', subscriptions: [] } as unknown as vscode.ExtensionContext;

const command = (id: string) => (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id)![1] as () => Promise<void>;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const launch = (script: string) => ({ kind: 'script', owner: 'vscode', nodePath: process.execPath, hostScript: `/ext/out/${script}.js`, electronRunAsNode: true });

describe('native-host commands', () => {
  beforeEach(() => {
    install.mockReset();
    refresh.mockReset().mockResolvedValue('unchanged');
    registerNativeHostCommands(context, adapters);
  });

  it('installs the helper host with the bundled helper script', async () => {
    install.mockResolvedValue({ browsers: [{ label: 'Edge' }], warnings: [] });
    await command('labshelf.buildLatexForBrowser')();
    expect(install).toHaveBeenCalledWith(expect.anything(), HELPER_HOST_SPEC, launch('helperHost'), { replaceStandalone: false });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('build LaTeX for Edge'));
  });

  it('installs the bridge host with the bundled bridge script', async () => {
    install.mockResolvedValue({ browsers: [{ label: 'Vivaldi' }], warnings: [] });
    await command('labshelf.connectBrowser')();
    expect(install).toHaveBeenCalledWith(expect.anything(), BRIDGE_HOST_SPEC, launch('bridgeHost'));
  });

  it('offers to replace a standalone helper and re-runs with replaceStandalone', async () => {
    install.mockResolvedValueOnce({ browsers: [], warnings: [], standalone: '/usr/bin/helper' }).mockResolvedValueOnce({ browsers: [{ label: 'Chrome' }], warnings: [] });
    (vscode.window.showInformationMessage as jest.Mock).mockResolvedValueOnce('Use VS Code instead');
    await command('labshelf.buildLatexForBrowser')();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('LabShelf Helper is installed and builds LaTeX for the browser.', 'Use VS Code instead');
    expect(install).toHaveBeenLastCalledWith(expect.anything(), HELPER_HOST_SPEC, launch('helperHost'), { replaceStandalone: true });
    expect(install).toHaveBeenCalledTimes(2);
  });

  it('keeps a standalone helper when the user dismisses the message', async () => {
    install.mockResolvedValue({ browsers: [], warnings: [], standalone: '/usr/bin/helper' });
    await command('labshelf.buildLatexForBrowser')();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('refreshes both launchers on registration and logs the ones it rewrote', async () => {
    refresh.mockResolvedValueOnce('refreshed').mockResolvedValueOnce('not-installed');
    registerNativeHostCommands(context, adapters);
    await flush();
    const specs = refresh.mock.calls.slice(-2).map(([, spec, script]) => [spec, script.hostScript]);
    expect(specs).toEqual([[BRIDGE_HOST_SPEC, '/ext/out/bridgeHost.js'], [HELPER_HOST_SPEC, '/ext/out/helperHost.js']]);
    expect(logger.log).toHaveBeenCalledWith('INFO', 'native-host-refresh', expect.any(String), expect.anything());
  });

  it('logs a failed refresh and still refreshes the other host', async () => {
    refresh.mockReset().mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce('unchanged');
    registerNativeHostCommands(context, adapters);
    await flush();
    expect(logger.error).toHaveBeenCalledWith('native-host-refresh', expect.any(Error), expect.anything());
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
