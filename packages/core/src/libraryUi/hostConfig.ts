// Declares optional host actions available to the library UI.
export interface LibraryUiCapabilities {
  /** Knows which PDFs lack a text layer, runs OCR (`paper.makeSearchable`) and reports its `jobs`. */
  textLayer?: boolean;
  /** Finds papers with similar content (`paper.similar`). */
  similar?: boolean;
  /** Shows the paper's folder in the system file manager (`paper.reveal`). */
  reveal?: boolean;
  /** Opens the PDF in the system's default app (`paper.openExternal`). */
  openExternal?: boolean;
  /** Looks the paper's metadata up online (`paper.fetchMetadata`). */
  fetchMetadata?: boolean;
  /** Searches the web for a missing PDF (`paper.findPdf`). */
  findPdf?: boolean;
  /** Attaches a PDF file the user picks (`paper.attachPdf`). */
  attachPdf?: boolean;
  /** Drafts an email asking the authors for a copy of a paper without a PDF (`paper.askAuthor`). */
  askAuthor?: boolean;
  spaces?: boolean;
}

export interface LibraryUiLabels {
  /** Tooltip of the header's Add button. */
  addTooltip: string;
  /** The line under "No papers here yet" that says how papers get in. */
  emptyHint: string;
  /** The menu label of the reveal capability, in the words the host's users know (such as "Reveal in Explorer"). */
  revealPaper?: string;
}
