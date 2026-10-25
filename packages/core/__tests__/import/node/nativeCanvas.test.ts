/** Loading the native canvas pdf.js renders on, and the geometry globals it installs. */
const GEOMETRY_GLOBALS = ['Path2D', 'DOMMatrix', 'ImageData', 'DOMPoint'];

describe('loadNativeCanvas', () => {
  const globals = globalThis as Record<string, unknown>;
  const saved = GEOMETRY_GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);

  afterEach(() => {
    for (const [name, descriptor] of saved) {
      delete globals[name];
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      }
    }
    jest.dontMock('@napi-rs/canvas');
    jest.dontMock('node:module');
  });

  function isolatedLoader(): () => unknown {
    let load: () => unknown = () => undefined;
    jest.isolateModules(() => {
      load = require('../../../src/import/node/nativeCanvas.js').loadNativeCanvas;
    });
    return load;
  }

  it('loads the installed canvas, caches it, and installs its geometry classes unconditionally', () => {
    class HostDomMatrix {}
    globals['DOMMatrix'] = HostDomMatrix;
    const load = isolatedLoader();

    const canvas = load() as { createCanvas: unknown; DOMMatrix: unknown; Path2D: unknown };

    expect(typeof canvas.createCanvas).toBe('function');
    expect(globals['DOMMatrix']).toBe(canvas.DOMMatrix);
    expect(globals['DOMMatrix']).not.toBe(HostDomMatrix);
    expect(globals['Path2D']).toBe(canvas.Path2D);
    expect(load()).toBe(canvas);
  });

  it('returns undefined and installs nothing when no native build can be required', () => {
    jest.doMock('node:module', () => ({ createRequire: () => () => { throw new Error('not installed'); } }));
    jest.doMock('@napi-rs/canvas', () => { throw new Error('not installed'); });
    for (const name of GEOMETRY_GLOBALS) {
      delete globals[name];
    }
    const load = isolatedLoader();

    expect(load()).toBeUndefined();
    expect(load()).toBeUndefined();
    expect(globals['Path2D']).toBeUndefined();
  });
});
