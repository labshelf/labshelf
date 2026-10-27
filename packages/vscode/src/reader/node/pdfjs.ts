/** Builds the extension host's PDF services from the settings (its one pdf.js, the OCR engine and the text-layer step) and finds the installed pdfjs-dist files the reader webview loads. */
import * as path from "node:path";
import * as vscode from "vscode";
import type { ILogger } from "@labshelf/core";
import { createPdfjsLoader, TextLayerPdfBuilder, TesseractOcrEngine } from "@labshelf/core/node";
import type { PdfjsFiles } from "../shell.js";

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
export function createTextLayerBuilder(engine: TesseractOcrEngine | undefined): TextLayerPdfBuilder {
  const config = vscode.workspace.getConfiguration("labshelf");
  return new TextLayerPdfBuilder(engine, hostPdfjs, { maxPages: config.get<number>("ocr.maxPages", 150) });
}

// PLATFORM: the pdfjs-dist/legacy build runs on more webview engines; the standard build is used when it is not installed.
const BUILDS = ["pdfjs-dist/legacy", "pdfjs-dist"] as const;

function resolveBuild(prefix: string): { files: string[]; entry: string } {
  const entry = require.resolve(`${prefix}/build/pdf.min.mjs`);
  const files = [
    entry,
    require.resolve(`${prefix}/build/pdf.worker.min.mjs`),
    require.resolve(`${prefix}/web/pdf_viewer.mjs`),
    require.resolve(`${prefix}/web/pdf_viewer.css`),
  ];
  return { files, entry };
}

// The package root holds cmaps/, standard_fonts/, wasm/ and iccs/, which the worker fetches at runtime.
function packageRoot(entry: string): string {
  const parent = path.resolve(path.dirname(entry), "..");
  return path.basename(parent) === "pdfjs-dist" ? parent : path.resolve(parent, "..");
}

/** @returns the pdfjs-dist files and package root, or null when the package cannot be resolved. */
export function findPdfjs(): PdfjsFiles | null {
  for (const prefix of BUILDS) {
    try {
      const { files: [pdfjs, worker, viewer, viewerCss], entry } = resolveBuild(prefix);
      return {
        pdfjs: vscode.Uri.file(pdfjs!),
        worker: vscode.Uri.file(worker!),
        viewer: vscode.Uri.file(viewer!),
        viewerCss: vscode.Uri.file(viewerCss!),
        root: vscode.Uri.file(packageRoot(entry)),
      };
    } catch {
      // Try the next build.
    }
  }
  return null;
}
