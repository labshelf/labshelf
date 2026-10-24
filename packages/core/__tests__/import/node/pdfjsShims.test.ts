/** The globals and FeatureTest patch that let pdf.js load inside an Electron utility process. */
import { installElectronGlobals, patchFeatureTestPlatform } from '../../../src/import/node/pdfjsShims.js';

describe('electron shims', () => {
  const savedNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const savedDomMatrix = Object.getOwnPropertyDescriptor(globalThis, 'DOMMatrix');

  afterEach(() => {
    for (const [name, saved] of [['navigator', savedNavigator], ['DOMMatrix', savedDomMatrix]] as const) {
      delete (globalThis as Record<string, unknown>)[name];
      if (saved) {
        Object.defineProperty(globalThis, name, saved);
      }
    }
  });

  it('defines navigator with a platform and user agent when the host has none', () => {
    Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });

    installElectronGlobals();

    const navigator = (globalThis as unknown as { navigator: { platform: string; userAgent: string } }).navigator;
    expect(typeof navigator.platform).toBe('string');
    expect(navigator.userAgent).toContain(process.version);
  });

  it('fills missing navigator fields without replacing the object', () => {
    const host = {};
    Object.defineProperty(globalThis, 'navigator', { value: host, configurable: true });

    installElectronGlobals();

    expect((globalThis as unknown as { navigator: unknown }).navigator).toBe(host);
    expect(typeof (host as { platform?: unknown }).platform).toBe('string');
  });

  it("never reads a navigator the host defines as a getter", () => {
    const get = jest.fn(() => ({}));
    Object.defineProperty(globalThis, 'navigator', { get, configurable: true });

    installElectronGlobals();

    expect(get).not.toHaveBeenCalled();
  });

  it('caches FeatureTest.platform when reading it throws', () => {
    const featureTest = {};
    Object.defineProperty(featureTest, 'platform', {
      get() { throw new Error('navigator is undefined'); },
      configurable: true,
    });
    const shadow = jest.fn();

    patchFeatureTestPlatform({ FeatureTest: featureTest, shadow });

    expect(shadow).toHaveBeenCalledWith(featureTest, 'platform', expect.objectContaining({ isLinux: true }));
  });

  it('leaves FeatureTest alone when reading it works', () => {
    const shadow = jest.fn();

    patchFeatureTestPlatform({ FeatureTest: { platform: { isMac: true } }, shadow });

    expect(shadow).not.toHaveBeenCalled();
  });
});
