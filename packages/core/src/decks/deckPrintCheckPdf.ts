/** Reads image placements from a pdf.js operator list for the print check: a pure walker (no pdfjs import) that follows the transformation matrix through save, restore, transform and form XObjects and returns each image's bounds in PDF points from the page's top left. Never throws on malformed args. */

/** The pdf.js `OPS` codes the walker needs; the caller passes them in so core does not import pdfjs. */
export interface PdfOperatorCodes { save: number; restore: number; transform: number; paintFormXObjectBegin: number; paintFormXObjectEnd: number; paintImageXObject: number; paintInlineImageXObject: number }

export interface PdfImagePlacement { left: number; top: number; width: number; height: number; pixelWidth: number; pixelHeight: number }

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function isMatrix(value: unknown): value is Matrix {
  return Array.isArray(value) && value.length === 6 && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

/** current x args: the args apply first, then the current matrix. */
function multiply(current: Matrix, args: Matrix): Matrix {
  const [a, b, c, d, e, f] = current;
  const [a2, b2, c2, d2, e2, f2] = args;
  return [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function pixelSize(code: number, args: unknown, codes: PdfOperatorCodes): [number, number] | undefined {
  if (code === codes.paintImageXObject) {
    const list = Array.isArray(args) ? args : [];
    return positiveNumber(list[1]) && positiveNumber(list[2]) ? [list[1], list[2]] : undefined;
  }
  const image = Array.isArray(args) ? args[0] : undefined;
  if (!image || typeof image !== "object") return undefined;
  const { width, height } = image as { width?: unknown; height?: unknown };
  return positiveNumber(width) && positiveNumber(height) ? [width, height] : undefined;
}

function placement(matrix: Matrix, size: [number, number], pageHeight: number): PdfImagePlacement {
  const [a, b, c, d, e, f] = matrix;
  const xs = [e, a + e, c + e, a + c + e];
  const ys = [f, b + f, d + f, b + d + f];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { left: round2(minX), top: round2(pageHeight - maxY), width: round2(maxX - minX), height: round2(maxY - minY), pixelWidth: size[0], pixelHeight: size[1] };
}

/** Image placements of a page's operator list, in paint order, in points from the page's top left. */
export function pdfImagePlacements(list: { fnArray: readonly number[]; argsArray: readonly unknown[] }, codes: PdfOperatorCodes, pageHeight: number): PdfImagePlacement[] {
  const placements: PdfImagePlacement[] = [];
  let matrix: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const fnArray = list?.fnArray ?? [];
  const argsArray = list?.argsArray ?? [];
  for (let i = 0; i < fnArray.length; i++) {
    const code = fnArray[i];
    const args = argsArray[i];
    if (code === codes.save) stack.push(matrix);
    else if (code === codes.restore || code === codes.paintFormXObjectEnd) matrix = stack.pop() ?? matrix;
    else if (code === codes.transform) {
      if (isMatrix(args)) matrix = multiply(matrix, args);
    } else if (code === codes.paintFormXObjectBegin) {
      stack.push(matrix);
      const form = Array.isArray(args) ? args[0] : undefined;
      if (isMatrix(form)) matrix = multiply(matrix, form);
    } else if (code === codes.paintImageXObject || code === codes.paintInlineImageXObject) {
      const size = pixelSize(code, args, codes);
      if (size) placements.push(placement(matrix, size, pageHeight));
    }
  }
  return placements;
}
