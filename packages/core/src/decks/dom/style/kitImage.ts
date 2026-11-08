// The pixels of a picked logo for its palette: decoded through a Blob URL and an Image, drawn at most 64 px on the long side to a canvas.
// The canvas and the decoder are injected like slideThumbnails.ts RasterDeps, so tests (jsdom has no canvas) fake them.
import { deckKitImageExtension, type DeckKitImage } from "../../deckKit.js";

/** The canvas factory and the image decoder; the decoder gives the image's natural size beside it. */
export interface KitImageDeps {
  createCanvas(width: number, height: number): HTMLCanvasElement;
  loadImage(blob: Blob): Promise<{ image: CanvasImageSource; width: number; height: number }>;
}

const LONG_SIDE_PX = 64;
const IMAGE_TIMEOUT_MS = 10_000;
const UNREADABLE = "This image could not be read.";
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", svg: "image/svg+xml", webp: "image/webp", gif: "image/gif" };

const defaultDeps: KitImageDeps = {
  createCanvas(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  },
  loadImage: (blob) =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      const done = (): void => { clearTimeout(timer); URL.revokeObjectURL(url); };
      const timer = setTimeout(() => { done(); reject(new Error(UNREADABLE)); }, IMAGE_TIMEOUT_MS);
      image.onload = () => { done(); resolve({ image, width: image.naturalWidth, height: image.naturalHeight }); };
      image.onerror = () => { done(); reject(new Error(UNREADABLE)); };
      image.src = url;
    }),
};

/**
 * The RGBA pixels of `image` scaled to at most 64 px on the long side (an image without a natural size, such as some SVGs, is drawn 64 x 64).
 * @throws Error "Unsupported image type." for an extension a kit may not hold, "This image could not be read." when it does not decode or there is no 2d context
 */
export async function readImagePixels(image: DeckKitImage, deps: KitImageDeps = defaultDeps): Promise<Uint8ClampedArray> {
  const ext = deckKitImageExtension(image.name);
  const type = ext === null ? undefined : MIME[ext];
  if (type === undefined) throw new Error("Unsupported image type.");
  let loaded: Awaited<ReturnType<KitImageDeps["loadImage"]>>;
  try {
    loaded = await deps.loadImage(new Blob([image.bytes.slice()], { type }));
  } catch {
    throw new Error(UNREADABLE);
  }
  const sized = loaded.width > 0 && loaded.height > 0;
  const naturalWidth = sized ? loaded.width : LONG_SIDE_PX;
  const naturalHeight = sized ? loaded.height : LONG_SIDE_PX;
  const scale = Math.min(1, LONG_SIDE_PX / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = deps.createCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error(UNREADABLE);
  try {
    context.drawImage(loaded.image, 0, 0, width, height);
    return Uint8ClampedArray.from(context.getImageData(0, 0, width, height).data);
  } catch {
    throw new Error(UNREADABLE);
  }
}
