/**
 * Builds a library webview's HTML shell (the list panel, the sidebar or the Details view): a strict CSP (the bundle's script by nonce,
 * styles and assets only from the extension), the bundled stylesheet and script, and the mount point. The UI arrives with the bundle.
 */
import * as vscode from 'vscode';
import { createNonce } from '@labshelf/core';
import { hasBundleFile, renderBundleMissingHtml, renderHtmlShell } from '../ui/index.js';

/** <extension>/dist/library, for localResourceRoots. */
export function readLibraryBundleDir(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, 'dist', 'library');
}

const REOPEN = { library: 'the list', sidebar: 'the sidebar', details: 'the Details view' } as const;

export async function listPanelHtml(webview: vscode.Webview, extensionUri: vscode.Uri, bundle: 'library' | 'sidebar' | 'details' = 'library'): Promise<string> {
  const dir = readLibraryBundleDir(extensionUri);
  const script = vscode.Uri.joinPath(dir, `${bundle}.js`);
  if (!(await hasBundleFile(script))) {
    return renderBundleMissingHtml({ title: 'LabShelf', heading: 'Library bundle not built', file: `dist/library/${bundle}.js`, reopen: REOPEN[bundle] });
  }
  return renderHtmlShell({
    nonce: createNonce(),
    cspSource: webview.cspSource,
    title: 'LabShelf',
    stylesheetUrl: webview.asWebviewUri(vscode.Uri.joinPath(dir, `${bundle}.css`)).toString(),
    scriptUrl: webview.asWebviewUri(script).toString(),
    dataImages: true,
  });
}
