/** The list shell checks for its bundle through the VS Code file system and says so when it is not built. */
import * as vscode from 'vscode';
import { listPanelHtml } from '../../src/libraryUi/listPanelHtml';

const webview = () => vscode.window.createWebviewPanel('t', 't', 1, {}).webview;

describe('listPanelHtml', () => {
  it('links the bundle when library.js exists', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValueOnce({ type: vscode.FileType.File });

    const html = await listPanelHtml(webview(), vscode.Uri.file('/ext'));

    expect(html).toContain('library.js');
    expect(html).toContain('<div id="root"></div>');
  });

  it('shows the text-only page when library.js is missing', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValueOnce(new Error('FileNotFound'));

    const html = await listPanelHtml(webview(), vscode.Uri.file('/ext'));

    expect(html).toContain('Library bundle not built');
    expect(html).not.toContain('<script');
  });
});
