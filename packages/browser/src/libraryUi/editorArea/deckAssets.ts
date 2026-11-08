// Deck asset proxies (D7): a deck's images as downscaled blob URLs for the editor and presenter, other assets as blobs of their own bytes, the full bytes
// for export, and full-resolution blob URLs for the poster preview.
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

interface UrlPorts { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void }

/** A per-path memo of blob URLs built by `makeBlob`, revoked together on dispose; a URL made after dispose is revoked at once. */
function createUrlCache(ports: UrlPorts, makeBlob: (path: string) => Promise<Blob | undefined>, fallback?: (path: string) => Promise<string>): { resolveAsset(path: string): Promise<string>; dispose(): void } {
  const urls = new Map<string, Promise<string>>();
  const created: string[] = [];
  let disposed = false;

  const load = async (path: string): Promise<string> => {
    const blob = await makeBlob(path);
    if (!blob) return (fallback as (path: string) => Promise<string>)(path);
    const url = ports.createObjectURL(blob);
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
    dispose: () => {
      disposed = true;
      for (const url of created.splice(0)) ports.revokeObjectURL(url);
      urls.clear();
    },
  };
}

/** Resolves asset paths of one deck to blob URLs, one per path, revoked together on dispose. */
export function createDeckAssetResolver(fs: LibraryFileSystem, deckFolder: string, ports: UrlPorts & { downscale: (bytes: Uint8Array, mime: string, maxSide: number) => Promise<Blob> }): DeckAssetResolver {
  const cache = createUrlCache(ports, async (path) => {
    const file = resolveInFolder(deckFolder, path);
    const bytes = await fs.readFile(file);
    const mime = deckAssetMime(file);
    return DOWNSCALED.has(extension(file)) ? ports.downscale(bytes, mime, PROXY_MAX_SIDE) : new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime });
  });
  return {
    resolveAsset: cache.resolveAsset,
    original: async (path) => {
      const file = resolveInFolder(deckFolder, path);
      try {
        return await fs.readFile(file);
      } catch {
        return undefined;
      }
    },
    dispose: cache.dispose,
  };
}

/**
 * Resolves asset paths to blob URLs of their original bytes (typed by deckAssetMime), one per path, for views that measure images at full
 * resolution such as the poster print check. A path whose bytes are missing or unreadable falls back to the proxy of `assets`. Its URLs are
 * revoked on dispose; one created after dispose is revoked at once.
 */
export function createFullResolutionResolver(assets: DeckAssetResolver, ports: UrlPorts): { resolveAsset(path: string): Promise<string>; dispose(): void } {
  return createUrlCache(
    ports,
    async (path) => {
      const bytes = await assets.original(path).catch(() => undefined);
      return bytes ? new Blob([bytes as Uint8Array<ArrayBuffer>], { type: deckAssetMime(path) }) : undefined;
    },
    (path) => assets.resolveAsset(path),
  );
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
