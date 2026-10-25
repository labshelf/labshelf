// Finds the installed pdfjs-dist files the reader webview loads, through Node module resolution.
import * as path from "node:path";
import * as vscode from "vscode";
import type { PdfjsFiles } from "../readerShell.js";

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
export function locatePdfjs(): PdfjsFiles | null {
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
