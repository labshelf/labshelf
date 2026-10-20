// Declares the capabilities and labels the VS Code webviews give the shared library UI and Details pane.
import type { LibraryUiCapabilities, LibraryUiLabels } from "@labshelf/core";

export const libraryUiCapabilities: LibraryUiCapabilities = {
  textLayer: true, similar: true, reveal: true, openExternal: true,
  fetchMetadata: true,
};

export const libraryUiLabels: LibraryUiLabels = {
  addTooltip: "Add PDF or folder here",
  emptyHint: "Or drag PDFs onto a folder in the LabShelf sidebar.",
  revealPaper: "Reveal in Explorer",
};
