/** Builds the extension host's PDF services from the settings: its one pdf.js, the OCR engine and the text-layer step. */
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { createPdfjsLoader } from "@labshelf/core/node";

import { SearchablePdfBuilder } from "./searchablePdfBuilder";
import { TesseractOcrEngine } from "./tesseractOcrEngine";

/** The one pdf.js of the extension host: the PDF parser, the AI service and OCR all open PDFs through it. */
export const hostPdfjs = createPdfjsLoader({ electronShims: true });

/**
 * Builds the OCR fallback used when a PDF's text layer cannot be read. Returns undefined when the user has turned
 * it off, so imports skip it entirely.
 */
export function createOcrEngine(context: vscode.ExtensionContext, logger: ILogger): TesseractOcrEngine | undefined {
  const config = vscode.workspace.getConfiguration("labshelf");
  if (!config.get<boolean>("ocr.enabled", true)) {
    return undefined;
  }

  const engine = new TesseractOcrEngine({
    pdfjs: hostPdfjs,
    languages: config.get<string[]>("ocr.languages", ["eng"]),
    // Language data is downloaded once and reused across sessions.
    cachePath: vscode.Uri.joinPath(context.globalStorageUri, "ocr-cache").fsPath,
    onDiagnostic: (message) => void logger.log("INFO", "ocr", message),
  });
  context.subscriptions.push({ dispose: () => void engine.dispose() });
  return engine;
}

/**
 * Builds the step that classifies PDFs and gives scans a selectable text layer. It shares the import's OCR engine;
 * with OCR off it still classifies, so the library can flag scans. labshelf.ocr.makeSearchable only governs whether
 * that runs on its own after an import (commands/importProgress.ts).
 */
export function createTextLayerBuilder(engine: TesseractOcrEngine | undefined): SearchablePdfBuilder {
  const config = vscode.workspace.getConfiguration("labshelf");
  return new SearchablePdfBuilder(engine, hostPdfjs, { maxPages: config.get<number>("ocr.maxPages", 150) });
}
