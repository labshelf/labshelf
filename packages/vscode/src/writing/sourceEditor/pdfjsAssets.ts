// pdf.js for the LabShelf Editor webview, shared by the talk and poster workspace and Cite from Library: the folders the
// page may load from and the asset URLs its pdfAssets request answers.
import * as vscode from "vscode";

import { resolvePdfjsUris, type PdfjsLocator } from "../../reader/index.js";

type PdfjsFiles = ReturnType<PdfjsLocator>;
/** What the page gives pdf.js: the module, worker and data folder URLs (core's PdfDeckAssets, restated so this node-side file does not load the DOM). */
export interface PdfjsAssets { pdfjsUrl: string; workerUrl: string; cMapUrl?: string; stdFontUrl?: string; wasmUrl?: string; iccUrl?: string }

/** The pdf.js folders for the webview's localResourceRoots; none when pdf.js is not installed. */
export function pdfjsResourceRoots(pdfjs: PdfjsFiles): vscode.Uri[] {
  return pdfjs ? [pdfjs.root, vscode.Uri.joinPath(pdfjs.pdfjs, "..")] : [];
}

/** The pdf.js module, worker and data URLs as the page loads them; throws when pdf.js is not installed. */
export function describePdfjsAssets(webview: vscode.Webview, pdfjs: PdfjsFiles): PdfjsAssets {
  const urls = resolvePdfjsUris(webview, pdfjs);
  if (!urls) { throw new Error("PDF.js is not installed, so the PDF cannot be shown."); }
  return { pdfjsUrl: urls.pdfjsWebviewUri.toString(), workerUrl: urls.workerWebviewUri.toString(), cMapUrl: urls.cMapWebviewUrl, stdFontUrl: urls.standardFontWebviewUrl, wasmUrl: urls.wasmWebviewUrl, iccUrl: urls.iccWebviewUrl };
}
