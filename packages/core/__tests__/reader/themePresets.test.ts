import { PDF_THEMES } from '../../src/model/pdfTheme';
import { THEME_PRESETS, findPagePreset, derivePageColors } from '../../src/reader/themePresets';

describe('theme presets', () => {
  it('has exactly one page-colour preset per concrete theme', () => {
    const concrete = PDF_THEMES.filter((t) => t !== 'auto').sort();
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(concrete);
  });

  it('maps black-on-white to null so the light theme never recolours figures', () => {
    expect(derivePageColors(THEME_PRESETS.light.bg, THEME_PRESETS.light.text)).toBeNull();
    expect(derivePageColors('#FFFFFF', '#000000')).toBeNull();
    expect(derivePageColors(THEME_PRESETS.dark.bg, THEME_PRESETS.dark.text)).toEqual({
      background: '#1e1e1e', foreground: '#e8e8e8',
    });
  });

  it('falls back to light for an unknown theme', () => {
    expect(findPagePreset('nope')).toEqual(THEME_PRESETS.light);
  });
});
