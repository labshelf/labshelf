// Tests the reader webview shell and the VS Code theme mapping.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_READER_PREFS, PROTOCOL_VERSION } from '@labshelf/core';
import {
  deriveReaderTheme, onAutoReaderThemeChange, readAutoReaderTheme, renderReaderShell, resolvePdfjsUris, resolveReaderBundleUris, serializeStartup,
} from '../../src/reader/shell';
import { statFromDisk } from '../support/diskStat';

const vscode = require('vscode');

describe('readerShell.test', () => {
  const PDFJS_FILES = {
    pdfjs: vscode.Uri.file('/pdfjs/build/pdf.min.mjs'),
    worker: vscode.Uri.file('/pdfjs/build/pdf.worker.min.mjs'),
    viewer: vscode.Uri.file('/pdfjs/web/pdf_viewer.mjs'),
    viewerCss: vscode.Uri.file('/pdfjs/web/pdf_viewer.css'),
    root: vscode.Uri.file('/pdfjs'),
  };

  beforeAll(() => statFromDisk());

  function makeWebviewMock() {
    return {
      cspSource: 'vscode-resource:',
      asWebviewUri: jest.fn((uri: { fsPath?: string }) => ({
        toString: () => `vscode-resource:${uri.fsPath ?? ''}`,
      })),
    };
  }

  // The shell links the esbuild output, so a built bundle must exist on disk for the normal path.
  function makeExtensionDir(withBundle: boolean): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-reader-'));
    if (withBundle) {
      fs.mkdirSync(path.join(dir, 'dist', 'reader'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'dist', 'reader', 'reader.js'), '// bundle');
      fs.writeFileSync(path.join(dir, 'dist', 'reader', 'reader.css'), '/* css */');
    }
    return dir;
  }

  function readBoot(html: string): any {
    const m = html.match(/<script id="labshelf-boot" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) { throw new Error('boot block missing'); }
    return JSON.parse(m[1]!);
  }

  describe('renderReaderShell', () => {
    let extensionDir: string;

    beforeAll(() => { extensionDir = makeExtensionDir(true); });
    afterAll(() => { fs.rmSync(extensionDir, { recursive: true, force: true }); });

    beforeEach(() => {
      vscode.window.activeColorTheme = { kind: 2 }; // dark
    });

    describe('output', () => {
      function makeParams(overrides = {}) {
        const webview = makeWebviewMock() as any;
        return {
          webview,
          extensionUri: vscode.Uri.file(extensionDir),
          pdfUri: vscode.Uri.file('/papers/paper1/paper.pdf'),
          paperId: 'paper-1',
          paperTitle: 'Test Paper',
          preview: false,
          prefs: DEFAULT_READER_PREFS,
          pdfjs: PDFJS_FILES,
          isMac: false,
          ...overrides,
        };
      }

      it('includes the paper title in the HTML', async () => {
        const html = await renderReaderShell(makeParams({ paperTitle: 'My Awesome Paper' }));
        expect(html).toContain('<title>My Awesome Paper</title>');
      });

      it('keeps the CSP that pdf.js needs (nonce, wasm, blob worker)', async () => {
        const html = await renderReaderShell(makeParams());
        expect(html).toContain('Content-Security-Policy');
        expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9+/]{22}==' 'wasm-unsafe-eval' vscode-resource:/);
        expect(html).toContain('worker-src vscode-resource: blob:');
        expect(html).toContain("default-src 'none'");
      });

      it('loads the bundled runtime as a nonce-tagged module script and its stylesheet', async () => {
        const html = await renderReaderShell(makeParams());
        const nonce = html.match(/nonce-([A-Za-z0-9+/]{22}==)/)?.[1];
        expect(html).toContain(`<script nonce="${nonce}" type="module" src=`);
        expect(html).toMatch(/<script [^>]*src="[^"]*dist\/reader\/reader\.js"><\/script>/);
        expect(html).toMatch(/<link rel="stylesheet" href="[^"]*dist\/reader\/reader\.css"\/>/);
        expect(html).toMatch(/<link rel="modulepreload" href="[^"]*reader\.js"\/>/);
      });

      it('places reader.css after pdf_viewer.css so reader rules win', async () => {
        const html = await renderReaderShell(makeParams());
        const viewerCss = html.indexOf('pdf_viewer.css');
        if (viewerCss >= 0) { expect(html.indexOf('reader.css')).toBeGreaterThan(viewerCss); }
      });

      it('preloads the PDF so the download starts during HTML parse', async () => {
        const html = await renderReaderShell(makeParams());
        expect(html).toMatch(/<link rel="preload" href="[^"]*paper\.pdf" as="fetch"/);
      });

      it('contains only structural containers; controls are built by the bundle', async () => {
        const html = await renderReaderShell(makeParams());
        for (const id of [
          'app', 'sidebar', 'sidebar-resizer', 'pdf-shell', 'toolbar', 'find-bar', 'viewerContainer', 'viewer',
          'status-pill', 'loading-msg', 'error-msg', 'selection-toolbar', 'hover-popup', 'cheatsheet',
        ]) {
          expect(html).toContain(`id="${id}"`);
        }
        expect(html).toContain('<div id="viewer" class="pdfViewer">');
        expect(html).not.toContain('<button');
      });

      it('serializes boot params that round-trip through the JSON block', async () => {
        const prefs = { ...DEFAULT_READER_PREFS, vimKeys: true, citationStyle: 'latex' as const };
        const boot = readBoot(await renderReaderShell(makeParams({ prefs, isMac: true })));
        expect(boot.paperId).toBe('paper-1');
        expect(boot.paperTitle).toBe('Test Paper');
        expect(boot.themePreference).toBe('auto');
        expect(boot.prefs).toEqual(prefs);
        expect(boot.assets.pdfUrl).toContain('paper.pdf');
        expect(boot.isMac).toBe(true);
        expect(boot.protocolVersion).toBe(PROTOCOL_VERSION);
      });

      it('sets the initial data-pdf-theme attribute to the VS Code theme', async () => {
        const html = await renderReaderShell(makeParams());
        expect(html).toContain('<html id="root" lang="en" data-pdf-theme="dark">');
        expect(readBoot(html).effectiveTheme).toBe('dark');
      });

      it('escapes special characters in paper title', async () => {
        const html = await renderReaderShell(makeParams({ paperTitle: '<script>alert("xss")</script>' }));
        expect(html).not.toContain('<script>alert');
        expect(html).toContain('&lt;script&gt;');
      });

      it('cannot be broken out of the boot block by a crafted title', async () => {
        const title = '</script><script>alert(1)</script>';
        const html = await renderReaderShell(makeParams({ paperTitle: title }));
        expect(html).not.toContain('</script><script>alert');
        expect(readBoot(html).paperTitle).toBe(title);
      });

      it('generates different nonces on each call', async () => {
        const html1 = await renderReaderShell(makeParams());
        const html2 = await renderReaderShell(makeParams());
        const nonce1 = html1.match(/nonce-([A-Za-z0-9+/]{22}==)/)?.[1];
        const nonce2 = html2.match(/nonce-([A-Za-z0-9+/]{22}==)/)?.[1];
        expect(nonce1).toBeTruthy();
        expect(nonce2).toBeTruthy();
        expect(nonce1).not.toBe(nonce2);
      });

      it('renders an explicit error page when the bundle has not been built', async () => {
        const bare = makeExtensionDir(false);
        try {
          const html = await renderReaderShell(makeParams({ extensionUri: vscode.Uri.file(bare) }));
          expect(html).toContain('Reader bundle not built');
          expect(html).toContain('pnpm --filter @labshelf/vscode build');
          expect(html).not.toContain('<script');
        } finally {
          fs.rmSync(bare, { recursive: true, force: true });
        }
      });
    });

    describe('serializeStartup', () => {
      it('escapes "<" and the JS line separators', () => {
        const out = serializeStartup({ paperTitle: 'a<b\u2028c\u2029d' } as any);
        expect(out).not.toContain('<');
        expect(out).toContain('\\u003c');
        expect(out).not.toMatch(/[\u2028\u2029]/);
        expect(JSON.parse(out).paperTitle).toBe('a<b\u2028c\u2029d');
      });
    });

    describe('resolveReaderBundleUris', () => {
      it('returns null without a built bundle and URIs with one', async () => {
        const webview = makeWebviewMock() as any;
        const bare = makeExtensionDir(false);
        try {
          expect(await resolveReaderBundleUris(webview, vscode.Uri.file(bare))).toBeNull();
        } finally {
          fs.rmSync(bare, { recursive: true, force: true });
        }
        const uris = await resolveReaderBundleUris(webview, vscode.Uri.file(extensionDir));
        expect(uris?.scriptUri.toString()).toContain(path.join('dist', 'reader', 'reader.js'));
        expect(uris?.styleUri.toString()).toContain(path.join('dist', 'reader', 'reader.css'));
      });
    });

    describe('resolvePdfjsUris', () => {
      it('maps the located files and the package root to webview URIs', () => {
        const resolved = resolvePdfjsUris(makeWebviewMock() as any, PDFJS_FILES);
        expect(resolved?.pdfjsWebviewUri.toString()).toBe('vscode-resource:/pdfjs/build/pdf.min.mjs');
        expect(resolved?.viewerCssWebviewUri.toString()).toBe('vscode-resource:/pdfjs/web/pdf_viewer.css');
        expect(resolved?.cMapWebviewUrl).toBe('vscode-resource:/pdfjs/cmaps/');
        expect(resolved?.iccWebviewUrl).toBe('vscode-resource:/pdfjs/iccs/');
      });

      it('returns null when pdf.js was not located', () => {
        expect(resolvePdfjsUris(makeWebviewMock() as any, null)).toBeNull();
      });
    });
  });
});

describe('vscodeTheme.test', () => {
  describe('vscodeTheme', () => {
    beforeEach(() => {
      vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Dark };
    });

    it.each([[1, 'light'], [2, 'dark'], [3, 'high-contrast'], [4, 'light'], [99, 'light']])(
      'maps ColorThemeKind %i to %s', (kind, theme) => {
        expect(deriveReaderTheme(kind)).toBe(theme);
      },
    );

    it('resolves the auto theme from the active VS Code theme', () => {
      expect(readAutoReaderTheme()).toBe('dark');
      vscode.window.activeColorTheme = { kind: vscode.ColorThemeKind.Light };
      expect(readAutoReaderTheme()).toBe('light');
    });

    it('reports the mapped theme when the VS Code theme changes', () => {
      const callback = jest.fn();
      const disposable = onAutoReaderThemeChange(callback);
      const listener = (vscode.window.onDidChangeActiveColorTheme as jest.Mock).mock.calls.at(-1)[0];
      listener({ kind: 3 });
      expect(callback).toHaveBeenCalledWith('high-contrast');
      disposable.dispose();
    });
  });
});
