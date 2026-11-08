/** @jest-environment jsdom */
/** Spec 4b.2: readImagePixels decodes a picked image through injected raster deps (jsdom has no canvas) at most 64 px on the long side. */
import { readImagePixels, type KitImageDeps } from "../../../../src/decks/dom/style/kitImage";

interface Drawn { canvas: [number, number]; draw: unknown[]; blobs: Blob[] }

function fakeDeps(size: { width: number; height: number }, options: { noContext?: boolean; fail?: boolean } = {}): KitImageDeps & { drawn: Drawn } {
  const drawn: Drawn = { canvas: [0, 0], draw: [], blobs: [] };
  const image = { id: "image" } as unknown as CanvasImageSource;
  return {
    drawn,
    createCanvas(width, height) {
      drawn.canvas = [width, height];
      const context = {
        drawImage: (...args: unknown[]) => { drawn.draw = args; },
        getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(7) }),
      };
      return { width, height, getContext: () => (options.noContext ? null : context) } as unknown as HTMLCanvasElement;
    },
    loadImage(blob) {
      drawn.blobs.push(blob);
      return options.fail ? Promise.reject(new Error("decode")) : Promise.resolve({ image, ...size });
    },
  };
}

const bytes = Uint8Array.from([1, 2, 3]);

describe("readImagePixels (4b.2)", () => {
  it("4b.2 scales the long side to 64 px and returns the pixels drawn", async () => {
    const deps = fakeDeps({ width: 200, height: 100 });
    const pixels = await readImagePixels({ name: "logo.png", bytes }, deps);
    expect(deps.drawn.canvas).toEqual([64, 32]);
    expect(deps.drawn.draw).toEqual([{ id: "image" }, 0, 0, 64, 32]);
    expect(pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(pixels.length).toBe(64 * 32 * 4);
    expect(deps.drawn.blobs[0]!.type).toBe("image/png");
  });

  it("4b.2 keeps a small image at its size and types by extension", async () => {
    const deps = fakeDeps({ width: 10, height: 20 });
    await readImagePixels({ name: "Mark.SVG", bytes }, deps);
    expect(deps.drawn.canvas).toEqual([10, 20]);
    expect(deps.drawn.blobs[0]!.type).toBe("image/svg+xml");
    await readImagePixels({ name: "a.jpg", bytes }, deps);
    expect(deps.drawn.blobs[1]!.type).toBe("image/jpeg");
    await readImagePixels({ name: "a.webp", bytes }, deps);
    expect(deps.drawn.blobs[2]!.type).toBe("image/webp");
  });

  it("4b.2 rejects without a 2d context, on a decode failure and on an unsupported type", async () => {
    await expect(readImagePixels({ name: "a.png", bytes }, fakeDeps({ width: 4, height: 4 }, { noContext: true }))).rejects.toThrow("This image could not be read.");
    await expect(readImagePixels({ name: "a.gif", bytes }, fakeDeps({ width: 4, height: 4 }, { fail: true }))).rejects.toThrow("This image could not be read.");
    const deps = fakeDeps({ width: 4, height: 4 });
    await expect(readImagePixels({ name: "a.bmp", bytes }, deps)).rejects.toThrow("Unsupported image type.");
    expect(deps.drawn.blobs).toHaveLength(0);
  });
});
