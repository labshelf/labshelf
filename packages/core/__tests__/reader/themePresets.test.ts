import { PDF_THEMES } from '../../src/model/pdfTheme';
import { THEME_PRESETS, presetFor, toPageColors } from '../../src/reader/themePresets';

describe('theme presets', () => {
  it('has exactly one page-colour preset per concrete theme', () => {
    const concrete = PDF_THEMES.filter((t) => t !== 'auto').sort();
    expect(Object.keys(THEME_PRESETS).sort()).toEqual(concrete);
  });

  it('maps black-on-white to null so the light theme never recolours figures', () => {
    expect(toPageColors(THEME_PRESETS.light.bg, THEME_PRESETS.light.text)).toBeNull();
    expect(toPageColors('#FFFFFF', '#000000')).toBeNull();
    expect(toPageColors(THEME_PRESETS.dark.bg, THEME_PRESETS.dark.text)).toEqual({
      background: '#1e1e1e', foreground: '#e8e8e8',
    });
  });

  it('falls back to light for an unknown theme', () => {
    expect(presetFor('nope')).toEqual(THEME_PRESETS.light);
  });
});
