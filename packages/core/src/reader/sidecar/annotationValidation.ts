/** Validates annotation fields (page number, color, normalized position) before they are stored. */
import { ANNOTATION_COLORS, type AnnotationColor, type AnnotationPosition } from "../../model/index.js";

/**
 * Throws when the page number is not a positive integer.
 */
export function validatePageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Invalid page number: ${pageNumber}. Must be a positive integer`);
  }
}

/**
 * @returns the color, typed; throws for anything outside ANNOTATION_COLORS.
 */
export function validateAnnotationColor(color: string): AnnotationColor {
  if (!ANNOTATION_COLORS.includes(color as AnnotationColor)) {
    throw new Error(`Invalid annotation color: ${color}. Must be one of: ${ANNOTATION_COLORS.join(", ")}`);
  }
  return color as AnnotationColor;
}

/**
 * @returns a position whose x, y, width and height are normalized to the page (0..1); throws otherwise.
 */
export function validateAnnotationPosition(pos: unknown): AnnotationPosition {
  if (!pos || typeof pos !== "object" || Array.isArray(pos)) {
    throw new Error("Position must be an object with x, y, width, height");
  }
  const p = pos as Record<string, unknown>;
  const { x, y, width, height } = p;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    throw new Error("Position fields x, y, width, height must be numbers");
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1 || x + width > 1 || y + height > 1) {
    throw new Error("Position values must be normalized (0.0-1.0) and width/height must be positive");
  }
  return { x, y, width, height };
}
