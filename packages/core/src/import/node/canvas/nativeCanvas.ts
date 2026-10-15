/** Loads the native Skia canvas pdf.js draws on in Node, and installs its geometry classes as globals. */
import { createRequire } from "node:module";

import { pdfjsPackageJson } from "../pdfjsPackage.js";

export interface NativeCanvasContext {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
}

export interface NativeCanvas {
  width: number;
  height: number;
  getContext(kind: "2d", options?: Record<string, unknown>): NativeCanvasContext;
  toBuffer(mime: "image/png"): Buffer;
}

export interface NativeCanvasModule {
  createCanvas(width: number, height: number): NativeCanvas;
}

const GEOMETRY_GLOBALS = ["Path2D", "DOMMatrix", "ImageData", "DOMPoint"];

let cached: NativeCanvasModule | null | undefined;

/**
 * pdf.js builds Path2D, DOMMatrix and ImageData from globals and hands them to the canvas context, which rejects any
 * implementation but its own, so the canvas's classes replace whatever the host defines.
 *
 * The copy pdfjs-dist itself depends on is preferred: two versions of the native Skia binding in one process exchange
 * incompatible objects and crash the host with a segmentation fault rather than an exception.
 * @returns the canvas module, or undefined when no native build is installed
 */
export function loadNativeCanvas(): NativeCanvasModule | undefined {
  if (cached === undefined) {
    cached = tryLoad();
  }
  return cached ?? undefined;
}

function tryLoad(): NativeCanvasModule | null {
  for (const requireCanvas of canvasRequirers()) {
    try {
      const loaded = requireCanvas("@napi-rs/canvas") as NativeCanvasModule & Record<string, unknown>;
      const globals = globalThis as Record<string, unknown>;
      for (const name of GEOMETRY_GLOBALS) {
        if (loaded[name]) {
          globals[name] = loaded[name];
        }
      }
      return loaded;
    } catch {
      // Not installed next to this resolution root; the next one may have it.
    }
  }
  return null;
}

function canvasRequirers(): Array<(id: string) => unknown> {
  const requirers: Array<(id: string) => unknown> = [];
  const pdfjsPackage = pdfjsPackageJson();
  if (pdfjsPackage) {
    requirers.push(createRequire(pdfjsPackage));
  }
  if (typeof require === "function") {
    requirers.push(require);
  }
  return requirers;
}
