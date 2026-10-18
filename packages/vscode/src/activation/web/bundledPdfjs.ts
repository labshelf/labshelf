// Locates the pdf.js copy a web host bundles in the extension's pdfjs/ folder, laid out as the pdfjs-dist package.
// CONTRACT: documents/contracts/editor-host.md#pdfjs
import * as vscode from "vscode";

import type { PdfjsLocator } from "../../pdf-viewer/index.js";

export function bundledPdfjs(extensionUri: vscode.Uri): PdfjsLocator {
  const root = vscode.Uri.joinPath(extensionUri, "pdfjs");
  const files = {
    pdfjs: vscode.Uri.joinPath(root, "build/pdf.min.mjs"),
    worker: vscode.Uri.joinPath(root, "build/pdf.worker.min.mjs"),
    viewer: vscode.Uri.joinPath(root, "web/pdf_viewer.mjs"),
    viewerCss: vscode.Uri.joinPath(root, "web/pdf_viewer.css"),
    root,
  };
  return () => files;
}
