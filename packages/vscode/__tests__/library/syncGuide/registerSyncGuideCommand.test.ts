import { syncGuide } from '@labshelf/core';
import { isGuideLink, parseOpenLink } from '../../../src/library/syncGuide/registerSyncGuideCommand';

describe('isGuideLink', () => {
  it('accepts every url the guide lists, the no-cloud tool included', () => {
    for (const tool of [...syncGuide.tools, syncGuide.noCloud.tool]) { expect(isGuideLink(tool.url)).toBe(true); }
  });

  it('rejects other urls, look-alikes, other schemes and non-strings', () => {
    const listed = syncGuide.noCloud.tool.url;
    for (const url of ['https://evil.example/', `${listed}.evil.example`, `${listed}?x=1`, 'file:///etc/passwd', 'javascript:alert(1)', '', undefined, 42, null]) {
      expect(isGuideLink(url)).toBe(false);
    }
  });
});

describe('parseOpenLink', () => {
  it('returns the url of an openLink message only', () => {
    expect(parseOpenLink({ type: 'openLink', url: 'https://a' })).toBe('https://a');
    expect(parseOpenLink({ type: 'other', url: 'https://a' })).toBeNull();
    expect(parseOpenLink({ type: 'openLink', url: 3 })).toBeNull();
    expect(parseOpenLink('openLink')).toBeNull();
    expect(parseOpenLink(null)).toBeNull();
  });
});
