// Declares the shape of a parsed SyncTeX file: boxes and marks per page in PDF points, and the first position of every source line.

/** A line of the typeset output: its source position, its box in points from the page's top-left corner and what it contains. */
export interface SyncBox {
  tag: number;
  line: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  baseline: number;
  children: SyncNode[];
}

/** A point mark (character run, glue, kern, math) at a baseline position, `right` being where its width ends. */
export interface SyncMark {
  tag: number;
  line: number;
  x: number;
  y: number;
  right: number;
}

export type SyncNode = SyncBox | SyncMark;

interface SyncLinePosition {
  page: number;
  x: number;
  y: number;
  /** Whether a mark (text, glue, kern) gave the position rather than a box. */
  mark: boolean;
}

export interface SyncFileLines {
  /** The first position of each source line that produced output. */
  positions: Map<number, SyncLinePosition>;
  /** The lines of `positions`, ascending. */
  lines: number[];
}

export interface SyncIndex {
  /** Input tag to normalised absolute path. */
  files: ReadonlyMap<number, string>;
  /** Page number to the top-level nodes of that page. */
  pages: ReadonlyMap<number, readonly SyncNode[]>;
  /** Normalised absolute path to the lines it produced. */
  byFile: ReadonlyMap<string, SyncFileLines>;
}

export interface SourceLocation {
  /** Normalised absolute path with "/" separators. */
  file: string;
  /** 1-based. */
  line: number;
}

export const isBox = (node: SyncNode): node is SyncBox => "children" in node;

export type SynctexRead = { status: "found"; index: SyncIndex } | { status: "missing"; path: string };
