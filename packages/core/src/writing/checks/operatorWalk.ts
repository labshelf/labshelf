/** Finds the fonts and placed raster images of one page in its pdf.js operator list. */
import type { PlacedImage } from "./checkTypes.js";

type Matrix = [number, number, number, number, number, number];

export interface OperatorList {
  fnArray: ArrayLike<number>;
  argsArray: ArrayLike<unknown>;
}

export interface PageOperators {
  /** pdf.js ids of the fonts the page sets, in first-use order. */
  fontIds: string[];
  images: PlacedImage[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `ctm · m`, the order canvas `transform()` applies, which is how pdf.js replays the list. */
function multiply(ctm: Matrix, m: ArrayLike<number>): Matrix {
  return [
    ctm[0] * m[0]! + ctm[2] * m[1]!,
    ctm[1] * m[0]! + ctm[3] * m[1]!,
    ctm[0] * m[2]! + ctm[2] * m[3]!,
    ctm[1] * m[2]! + ctm[3] * m[3]!,
    ctm[0] * m[4]! + ctm[2] * m[5]! + ctm[4],
    ctm[1] * m[4]! + ctm[3] * m[5]! + ctm[5],
  ];
}

const isMatrix = (value: unknown): value is ArrayLike<number> =>
  value !== null && typeof value === "object" && (value as ArrayLike<number>).length === 6;

/**
 * Tracks the transform through save/restore and form XObjects, because an image is drawn into the unit square of the
 * current transform: its drawn size is the length of the transform's two axis vectors.
 */
export function walkOperators(list: OperatorList, OPS: Record<string, number>): PageOperators {
  const fontIds: string[] = [];
  const images: PlacedImage[] = [];
  const stack: Matrix[] = [];
  let ctm = IDENTITY;
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    const args = (list.argsArray[i] ?? []) as unknown[];
    if (fn === OPS["save"]) { stack.push(ctm); continue; }
    if (fn === OPS["restore"] || fn === OPS["paintFormXObjectEnd"]) { ctm = stack.pop() ?? IDENTITY; continue; }
    if (fn === OPS["transform"]) { ctm = multiply(ctm, args as number[]); continue; }
    if (fn === OPS["paintFormXObjectBegin"]) {
      stack.push(ctm);
      if (isMatrix(args[0])) { ctm = multiply(ctm, args[0]); }
      continue;
    }
    if (fn === OPS["setFont"] && typeof args[0] === "string" && !fontIds.includes(args[0])) { fontIds.push(args[0]); continue; }
    if (fn === OPS["paintImageXObject"] && typeof args[1] === "number" && typeof args[2] === "number") {
      images.push({ pixelWidth: args[1], pixelHeight: args[2], width: Math.hypot(ctm[0], ctm[1]), height: Math.hypot(ctm[2], ctm[3]) });
    }
  }
  return { fontIds, images };
}
