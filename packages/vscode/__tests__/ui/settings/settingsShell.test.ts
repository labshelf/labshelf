/**
 * The settings shell: a strict CSP with no inline allowance, one stylesheet and one module script from the bundle
 * folder, a fresh nonce per render, and a text-only page when the bundle is not built.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { statFromDisk } from '../../support/diskStat';
import { settingsBundleDirectory, settingsShellHtml } from '../../../src/ui/settings/settingsShell';

function extensionDir(withBundle: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-settings-'));
  if (withBundle) {
    fs.mkdirSync(path.join(dir, 'dist', 'settings'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'settings', 'settings.js'), '// bundle');
    fs.writeFileSync(path.join(dir, 'dist', 'settings', 'settings.css'), '/* css */');
  }
  return dir;
}

function render(dir: string): Promise<string> {
  const panel = vscode.window.createWebviewPanel('t', 't', 1, {});
  return settingsShellHtml(panel.webview, vscode.Uri.file(dir));
}

describe('settingsShell', () => {
  let built: string;
  let bare: string;
  beforeAll(() => { statFromDisk(); built = extensionDir(true); bare = extensionDir(false); });
  afterAll(() => {
    fs.rmSync(built, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  });

  it('allows scripts by nonce and styles from the extension only, with no inline allowance', async () => {
    const html = await render(built);
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toMatch(/^default-src 'none'; script-src 'nonce-[0-9a-f]{32}' vscode-resource:; style-src vscode-resource:;$/);
    expect(html).not.toContain('unsafe-inline');
    expect(html).not.toContain('<style');
    expect(html).not.toMatch(/ style=/);
  });

  it('uses the nonce on the one module script and links one stylesheet from the bundle folder', async () => {
    const html = await render(built);
    const nonce = /nonce-([0-9a-f]{32})/.exec(html)?.[1];
    expect(html.match(/<script /g)).toHaveLength(1);
    expect(html).toContain(`<script nonce="${nonce}" type="module" src="`);
    expect(html.match(/<link rel="stylesheet"/g)).toHaveLength(1);
    expect(html).toContain('settings.css');
    expect(html).toContain(path.join('dist', 'settings', 'settings.js'));
    expect(html).toContain('<div id="root"></div>');
  });

  it('draws a fresh nonce for every render', async () => {
    const nonceOf = async () => /nonce-([0-9a-f]{32})/.exec(await render(built))?.[1];
    expect(await nonceOf()).not.toBe(await nonceOf());
  });

  it('serves resources from the settings bundle folder', async () => {
    expect(settingsBundleDirectory(vscode.Uri.file('/ext')).fsPath).toBe(path.join('/ext', 'dist', 'settings'));
  });

  it('says the bundle is not built, with no style or script, when dist/settings is missing', async () => {
    const html = await render(bare);
    expect(html).toContain('Settings bundle not built');
    expect(html).toContain('pnpm --filter @labshelf/vscode build');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).toContain(`content="default-src 'none';"`);
  });
});
