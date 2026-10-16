/** Defines what the pre-submission check reads from a PDF and what it reports. */

export type CheckRule = "pages" | "anonymity" | "fonts" | "images" | "references";

/** A whole-document finding has no page; a source location is preferred whenever the text can be traced to a line. */
export type CheckLocation =
  | { kind: "pdf"; page?: number | undefined }
  | { kind: "source"; file: string; line: number };

export interface CheckFinding {
  rule: CheckRule;
  severity: "error" | "warning";
  message: string;
  location: CheckLocation;
}

/** A raster image as placed on the page: its pixels and the size it is drawn at, in points. */
export interface PlacedImage {
  pixelWidth: number;
  pixelHeight: number;
  width: number;
  height: number;
}

export interface PdfPageFacts {
  /** Text lines in content order. */
  lines: string[];
  /** Whether each font the page draws with is a Type 3 font. */
  fonts: Array<{ name: string; type3: boolean }>;
  images: PlacedImage[];
}

export interface PdfFacts {
  pages: PdfPageFacts[];
  /** The info dictionary's text fields. */
  info: Record<string, string>;
}

/** A project source file, split into lines. */
export interface CheckSource {
  file: string;
  lines: string[];
}
