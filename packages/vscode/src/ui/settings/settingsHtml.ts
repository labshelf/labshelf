/**
 * Renders the settings editor tab's HTML: library root, Drive sync state and the buttons that post commands back to the panel.
 */
import { createNonce, escapeHtml, renderTokensCss, renderVscodeHostCss } from "@labshelf/core";

export interface SettingsViewState {
  libraryRoot: string | null;
  connected: boolean;
  syncing: boolean;
  lastSync: string | null;
}

export function buildSettingsHtml(state: SettingsViewState): string {
  const nonce = createNonce();
  const rootLabel = state.libraryRoot
    ? escapeHtml(state.libraryRoot)
    : "No library configured";
  const syncStatus = state.syncing
    ? "Syncing..."
    : state.connected
      ? state.lastSync
        ? `Connected — last sync: ${escapeHtml(state.lastSync)}`
        : "Connected to Google Drive"
      : "Not connected to Google Drive";
  const syncActions = state.connected
    ? `<button data-command="sync.now">Sync now</button>
       <button data-command="sync.disconnect">Disconnect</button>`
    : `<button data-command="sync.connect">Connect to Google Drive</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
<style>
${renderTokensCss()}
${renderVscodeHostCss()}
  body { font-family: var(--ls-font); color: var(--ls-fg); padding: 24px 32px; }
  h1 { font-size: 1.4em; margin: 0 0 24px; }
  section { border-top: 1px solid var(--ls-border); padding: 16px 0; }
  h2 { font-size: 1em; margin: 0 0 8px; }
  p { margin: 0 0 12px; color: var(--ls-desc); word-break: break-all; }
  button { font-family: inherit; font-size: inherit; margin-right: 8px; padding: 4px 12px; border: none; cursor: pointer;
           color: var(--ls-button-fg); background: var(--ls-button-bg); }
  button:hover { background: var(--ls-button-hover); }
</style>
</head>
<body>
  <h1>LabShelf Settings</h1>

  <section>
    <h2>Library</h2>
    <p>${rootLabel}</p>
    <button data-command="library.reconfigure">Change library folder</button>
  </section>

  <section>
    <h2>Google Drive sync</h2>
    <p>${syncStatus}</p>
    ${syncActions}
  </section>

  <section>
    <h2>Preferences</h2>
    <p>Sync interval and AI options live in the VS Code settings UI.</p>
    <button data-command="settings.openNative">Open VS Code settings</button>
  </section>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const target = event.target.closest('button[data-command]');
      if (target) { vscode.postMessage({ command: target.dataset.command }); }
    });
  </script>
</body>
</html>`;
}
