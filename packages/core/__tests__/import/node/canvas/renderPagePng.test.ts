/** A page is drawn onto a white canvas sized to its viewport and returned as PNG bytes. */
import type { NativeCanvasModule } from '../../../../src/import/node/canvas/index.js';
import { renderPagePng } from '../../../../src/import/node/canvas/renderPagePng.js';

describe('renderPagePng', () => {
  it('paints a white sheet, renders the page onto it and returns the PNG', async () => {
    const calls: string[] = [];
    const context = { fillStyle: '', fillRect: jest.fn(), getImageData: () => ({ data: new Uint8ClampedArray(0) }) };
    context.fillRect.mockImplementation((): void => { calls.push(`fill ${context.fillStyle}`); });
    const png = Buffer.from([137, 80, 78, 71]);
    const canvas = { width: 0, height: 0, getContext: () => context, toBuffer: jest.fn(() => png) };
    const canvasModule: NativeCanvasModule = {
      createCanvas: jest.fn((width: number, height: number) => Object.assign(canvas, { width, height })),
    };
    const viewport = { width: 100.2, height: 50.5 };
    const page = {
      render: jest.fn((options: Record<string, unknown>) => {
        calls.push('render');
        expect(options).toMatchObject({ canvasContext: context, viewport, canvas });
        return { promise: Promise.resolve() };
      }),
    };

    const result = await renderPagePng(canvasModule, page, viewport);

    expect(canvasModule.createCanvas).toHaveBeenCalledWith(101, 51);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 101, 51);
    expect(calls).toEqual(['fill white', 'render']);
    expect(canvas.toBuffer).toHaveBeenCalledWith('image/png');
    expect(result).toBe(png);
  });
});
