// Exports the Node side of the decks domain: the deck tools of the MCP server.
export { createDeckTools } from "./deckTools.js";
export type { DeckToolsDeps } from "./deckTools.js";
export { findChromium, findSystemChromium } from "./findChromium.js";
export type { ChromiumCandidate, FindChromiumOptions } from "./findChromium.js";
export { chromiumPin, createManagedChromiumProvider, createSharedChromiumProvider } from "./managedChromium.js";
export type { ChromiumPin, ChromiumPinEntry, ManagedChromiumOptions, ManagedChromiumProvider, ManagedChromiumStatus } from "./managedChromium.js";
export { exportDeckPdf, printDeckPdf } from "./printPdf.js";
export type { DeckPdfResult, ExportDeckPdfOptions, PrintPdfOptions } from "./printPdf.js";
