/** Builds getDocument options that rasterize pages onto the native canvas instead of a DOM one. */
import type { NativeCanvas, NativeCanvasContext, NativeCanvasModule } from "./nativeCanvas.js";

/**
 * Hosts pdf.js does not recognise as Node would otherwise reach for document.createElement and FontFace.
 * @returns options to spread into getDocument
 */
export function nativeRenderOptions(canvas: NativeCanvasModule): Record<string, unknown> {
  return {
    CanvasFactory: canvasFactoryFor(canvas),
    FilterFactory: NoopFilterFactory,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    // Without a DOM there is no FontFace; glyphs are drawn as paths instead.
    disableFontFace: true,
    useSystemFonts: false,
  };
}

// Mirrors pdf.js' BaseFilterFactory: SVG filters need a DOM, so none are applied.
class NoopFilterFactory {
  addFilter(): string { return "none"; }
  addHCMFilter(): string { return "none"; }
  addAlphaFilter(): string { return "none"; }
  addLuminosityFilter(): string { return "none"; }
  addHighlightHCMFilter(): string { return "none"; }
  destroy(): void {}
}

interface CanvasAndContext {
  canvas: NativeCanvas | null;
  context: NativeCanvasContext | null;
}

// Mirrors pdf.js' BaseCanvasFactory over the given native canvas module.
function canvasFactoryFor(module: NativeCanvasModule): new (options?: Record<string, unknown>) => unknown {
  return class NativeCanvasFactory {
    create(width: number, height: number): CanvasAndContext {
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid canvas size");
      }
      const canvas = module.createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    }

    reset(target: CanvasAndContext, width: number, height: number): void {
      if (!target.canvas) {
        throw new Error("Canvas is not specified");
      }
      if (width <= 0 || height <= 0) {
        throw new Error("Invalid canvas size");
      }
      target.canvas.width = width;
      target.canvas.height = height;
    }

    destroy(target: CanvasAndContext): void {
      if (!target.canvas) {
        throw new Error("Canvas is not specified");
      }
      target.canvas.width = target.canvas.height = 0;
      target.canvas = null;
      target.context = null;
    }
  };
}
