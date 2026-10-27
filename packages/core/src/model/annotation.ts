/**
 * Declares annotations on a paper's PDF with their types and colours, and the text-layer verdict of the PDF with the
 * parser that validates it.
 */
export interface AnnotationPosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type AnnotationType = "highlight" | "note" | "comment" | "tag";

export const ANNOTATION_COLORS = ["yellow", "green", "blue", "red", "pink"] as const;
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

export function isAnnotationColor(value: unknown): value is AnnotationColor {
  return (ANNOTATION_COLORS as readonly unknown[]).includes(value);
}

export interface Annotation {
  id: string;
  paperId: string;
  type: AnnotationType;
  pageNumber: number;
  content: string;
  color?: AnnotationColor;
  position?: AnnotationPosition;
  createdAt: string;
  updatedAt: string;
}

/**
 * Whether a paper's PDF carries text that can be searched and selected:
 * native — the PDF was born digital; ocr — LabShelf read the scan and laid
 * invisible text over it; missing — a scan nobody has read yet (OCR off,
 * cancelled, over the page limit); failed — OCR was tried and did not work.
 */
export const TEXT_LAYER_STATES = ["native", "ocr", "missing", "failed"] as const;
export type TextLayerState = (typeof TEXT_LAYER_STATES)[number];

export interface TextLayerDetails {
  state: TextLayerState;
  // ocr: pages that received text, and pages that could not be read.
  ocrPages?: number;
  failedPages?: number;
  // missing / failed: why there is no text, in words a user can act on.
  reason?: string;
  // ISO timestamp of the check that produced this verdict.
  checkedAt: string;
}

/**
 * Validates a text-layer verdict read from disk or a database column, which
 * may come from an older version or a hand-edited file.
 * @returns The verdict, or undefined when the value is not a usable one.
 */
export function parseTextLayerDetails(value: unknown): TextLayerDetails | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw["state"] !== "string" || !(TEXT_LAYER_STATES as readonly string[]).includes(raw["state"])) {
    return undefined;
  }
  const count = (key: string): number | undefined =>
    typeof raw[key] === "number" && Number.isInteger(raw[key]) && (raw[key] as number) >= 0 ? (raw[key] as number) : undefined;
  const ocrPages = count("ocrPages");
  const failedPages = count("failedPages");
  return {
    state: raw["state"] as TextLayerState,
    checkedAt: typeof raw["checkedAt"] === "string" ? raw["checkedAt"] : "",
    ...(ocrPages !== undefined ? { ocrPages } : {}),
    ...(failedPages !== undefined ? { failedPages } : {}),
    ...(typeof raw["reason"] === "string" && raw["reason"] ? { reason: raw["reason"] } : {}),
  };
}
