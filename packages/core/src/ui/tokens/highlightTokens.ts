/**
 * The one highlight palette, keyed by the annotation colour names stored in `data.json`.
 */
import type { AnnotationColor } from "../../model/index.js";

// `note` paints an annotation that carries no colour of its own.
export const HIGHLIGHT_COLORS: Record<AnnotationColor | "note", string> = {
  yellow: "#f5c518",
  green: "#4caf50",
  blue: "#2196f3",
  red: "#f44336",
  pink: "#e91e63",
  note: "#9c27b0",
};
