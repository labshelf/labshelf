import { syncGuide } from '@labshelf/core';
import { isGuideUrl, parseOpenUrl } from '../../../src/library/syncGuide/registerSyncGuideCommand';

describe('isGuideUrl', () => {
  it('accepts every url the guide lists, the no-cloud tool included', () => {
    for (const tool of [...syncGuide.tools, syncGuide.noCloud.tool]) { expect(isGuideUrl(tool.url)).toBe(true); }
  });

  it('rejects other urls, look-alikes, other schemes and non-strings', () => {
    const listed = syncGuide.noCloud.tool.url;
    for (const url of ['https://evil.example/', `${listed}.evil.example`, `${listed}?x=1`, 'file:///etc/passwd', 'javascript:alert(1)', '', undefined, 42, null]) {
      expect(isGuideUrl(url)).toBe(false);
    }
  });
});

describe('parseOpenUrl', () => {
  it('returns the url of an openLink message only', () => {
    expect(parseOpenUrl({ type: 'openLink', url: 'https://a' })).toBe('https://a');
    expect(parseOpenUrl({ type: 'other', url: 'https://a' })).toBeNull();
    expect(parseOpenUrl({ type: 'openLink', url: 3 })).toBeNull();
    expect(parseOpenUrl('openLink')).toBeNull();
    expect(parseOpenUrl(null)).toBeNull();
  });
});
