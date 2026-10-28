/** The getDocument options that make pdf.js draw on the native canvas and never on a DOM one. */
import { createNativeCanvasOptions, type NativeCanvasModule } from '../../../src/import/node/nativeCanvas.js';

describe('createNativeCanvasOptions', () => {
  const context = { fillStyle: '', fillRect: jest.fn(), getImageData: () => ({ data: new Uint8ClampedArray(0) }) };
  const canvasModule: NativeCanvasModule = {
    createCanvas: jest.fn((width: number, height: number) => ({
      width,
      height,
      getContext: () => context,
      toBuffer: () => Buffer.alloc(0),
    })),
  };

  it('draws on the native canvas', () => {
    const Factory = createNativeCanvasOptions(canvasModule)['CanvasFactory'] as new () => {
      create(w: number, h: number): { canvas: { width: number } | null; context: unknown };
      destroy(target: { canvas: unknown; context: unknown }): void;
    };
    const factory = new Factory();

    const target = factory.create(20, 10);
    expect(canvasModule.createCanvas).toHaveBeenCalledWith(20, 10);
    expect(target.context).toBe(context);

    factory.destroy(target);
    expect(target.canvas).toBeNull();
    expect(() => factory.create(0, 10)).toThrow('Invalid canvas size');
  });

  it('turns off every browser-only rendering path', () => {
    const options = createNativeCanvasOptions(canvasModule);

    expect(options['disableFontFace']).toBe(true);
    expect(options['isOffscreenCanvasSupported']).toBe(false);
    expect(options['isImageDecoderSupported']).toBe(false);
    expect(options['useSystemFonts']).toBe(false);
  });
});
