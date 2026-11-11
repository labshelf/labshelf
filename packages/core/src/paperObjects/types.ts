/** The types shared by the paper-object service, its hosts and the note editor's "From paper…" picker. */

/** What a picker entry stands for: a numbered display equation, a figure or a table of a paper. */
export type PaperObjectKind = "equation" | "figure" | "table";

/** A rectangle on a page as fractions of the page from the top-left, like highlights and item `box` anchors. */
export interface PageBox { x: number; y: number; w: number; h: number }

/** One equation, figure or table found in a paper's PDF. */
export interface PaperObject {
  kind: PaperObjectKind;
  /** Lower-cased label as printed: "3", "2.1", "3a". */
  label: string;
  /** 1-based page. */
  page: number;
  /** Where the object is on its page, caption included for figures and tables. */
  box: PageBox;
  /** The caption's first line for figures and tables, the equation's line for equations; for the picker only. */
  caption: string;
}

/** Where the inserted content came from; anything but `arxiv` and `pdf-text` was read from an image. */
export type PaperObjectVia = "arxiv" | "pdf-text" | "pix2tex" | "ai" | "image";

/** What the note editor inserts for one object. */
export interface PaperObjectInsert {
  /** LabShelf Markdown blocks separated by one blank line: the content, then the paper link line. */
  markdown: string;
  /** Files to write beside the note before inserting the markdown, paths relative to the note's folder (`assets/…`). */
  assets: { path: string; bytes: Uint8Array }[];
  via: PaperObjectVia;
}

/** A library paper offered by the picker. */
export interface PaperChoice { id: string; citeKey: string | null; title: string; authors: string; year: string | null }

export interface PaperObjectInsertOptions {
  /** File name stem for an image asset, unique in the note (the editor passes a fresh item-like id). */
  assetName: string;
  /** Equation labels already used in the note, without the `eq-` prefix; a new label avoids them. */
  takenLabels: readonly string[];
  /** Insert the object as an image even when text could be read. */
  asImage?: boolean;
}

/** What a note editor may ask about library papers; hosts implement it, across a webview through a request/reply pair. */
export interface PaperObjectsPort {
  /** Library papers matching `query` (title, author, cite key), best first, at most 50; an empty query lists recent ones. */
  papers(query: string): Promise<PaperChoice[]>;
  /**
   * The paper's numbered equations, figures and tables in document order; empty when none were found. Rejects with an
   * Error whose message is exactly "This paper has no PDF." when the paper has no readable PDF; the picker shows it as is.
   */
  list(paperId: string): Promise<PaperObject[]>;
  /** A PNG of the object's region, for the picker's preview; null when it cannot be rendered. */
  preview(paperId: string, object: PaperObject): Promise<Uint8Array | null>;
  /** Builds what to insert, trying the exact sources first and falling back to an image. */
  insert(paperId: string, object: PaperObject, options: PaperObjectInsertOptions): Promise<PaperObjectInsert>;
}
