// Deck asset proxies (D7): a deck's images as downscaled blob URLs for the editor and presenter, other assets as blobs of their own bytes, and the full bytes for export.
import { deckAssetMime, type LibraryFileSystem } from "@labshelf/core";

export interface DeckAssetResolver { resolveAsset(path: string): Promise<string>; original(path: string): Promise<Uint8Array | undefined>; dispose(): void }

/** The longest side of an image proxy, in px. */
const PROXY_MAX_SIDE = 1600;
const DOWNSCALED = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const extension = (path: string): string => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
};

/** The library path of an asset path relative to the deck folder; throws when it leaves the folder or is absolute. */
function resolveInFolder(deckFolder: string, path: string): string {
  if (path.startsWith("/") || path.includes("\\")) throw new Error(`Deck asset path is not relative: ${path}`);
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) throw new Error(`Deck asset path leaves the deck folder: ${path}`);
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (segments.length === 0) throw new Error(`Deck asset path names no file: ${path}`);
  return [deckFolder.replace(/\/+$/, ""), ...segments].join("/");
}

/** Resolves asset paths of one deck to blob URLs, one per path, revoked together on dispose. */
export function createDeckAssetResolver(fs: LibraryFileSystem, deckFolder: string, ports: { downscale: (bytes: Uint8Array, mime: string, maxSide: number) => Promise<Blob>; createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void }): DeckAssetResolver {
  const urls = new Map<string, Promise<string>>();
  const created: string[] = [];
  let disposed = false;

  const load = async (path: string): Promise<string> => {
    const file = resolveInFolder(deckFolder, path);
    const bytes = await fs.readFile(file);
    const mime = deckAssetMime(file);
    const blob = DOWNSCALED.has(extension(file)) ? await ports.downscale(bytes, mime, PROXY_MAX_SIDE) : new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
    const url = ports.createObjectURL(blob);
    // A URL made after dispose is revoked at once; the tab that asked for it is gone.
    if (disposed) ports.revokeObjectURL(url);
    else created.push(url);
    return url;
  };

  return {
    resolveAsset: (path) => {
      const cached = urls.get(path);
      if (cached) return cached;
      const loading = load(path);
      urls.set(path, loading);
      // A failed load is not cached, so a file added later resolves on the next ask.
      loading.catch(() => { if (urls.get(path) === loading) urls.delete(path); });
      return loading;
    },
    original: async (path) => {
      const file = resolveInFolder(deckFolder, path);
      try {
        return await fs.readFile(file);
      } catch {
        return undefined;
      }
    },
    dispose: () => {
      disposed = true;
      for (const url of created.splice(0)) ports.revokeObjectURL(url);
      urls.clear();
    },
  };
}

/** Scales an image so its longest side is at most maxSide, keeping the aspect and never upscaling; the original bytes when already small enough. */
export async function downscaleImage(bytes: Uint8Array, mime: string, maxSide: number): Promise<Blob> {
  const source = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1) return source;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    // PLATFORM: OffscreenCanvas is missing in older Firefox pages; a detached canvas does the same work there.
    const type = mime === "image/jpeg" ? "image/jpeg" : "image/png";
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return source;
      context.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return source;
    context.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? source), type));
  } finally {
    bitmap.close();
  }
}
