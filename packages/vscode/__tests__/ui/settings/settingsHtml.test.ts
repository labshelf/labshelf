import { buildSettingsHtml } from '../../../src/ui/settings/settingsHtml';

const state = { libraryRoot: '/home/<me>/"lib"', connected: false, syncing: false, lastSync: null };

describe('buildSettingsHtml', () => {
  it('locks the inline script to one hex nonce used in both the CSP and the script tag', () => {
    const html = buildSettingsHtml(state);
    const nonce = /script-src 'nonce-([0-9a-f]{32})'/.exec(html)?.[1];
    expect(nonce).toBeDefined();
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('uses a fresh nonce for every render', () => {
    const nonceOf = () => /nonce-([0-9a-f]{32})/.exec(buildSettingsHtml(state))?.[1];
    expect(nonceOf()).not.toBe(nonceOf());
  });

  it('escapes the library root and the last sync time', () => {
    const html = buildSettingsHtml({ ...state, connected: true, lastSync: "<b>'x'</b>" });
    expect(html).toContain('/home/&lt;me&gt;/&quot;lib&quot;');
    expect(html).toContain('last sync: &lt;b&gt;&#39;x&#39;&lt;/b&gt;');
  });
});
