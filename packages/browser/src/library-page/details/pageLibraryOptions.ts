// Declares what the library page's host can do and how it words its empty state, for the list and for Details alike.
import type { LibraryUiCapabilities, LibraryUiLabels } from "@labshelf/core";

export const PAGE_CAPABILITIES: LibraryUiCapabilities = { findPdf: true, attachPdf: true, askAuthor: true };

export const PAGE_LABELS: LibraryUiLabels = {
  addTooltip: "Add a paper from an open tab",
  emptyHint: "Open the paper's page in a tab and use the LabShelf toolbar button, or click Add to pick one of your open tabs.",
};
