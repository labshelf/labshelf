/**
 * Generates the HTML shell of the PDF reader webview; all behaviour lives in the bundle built by build/webviews.mjs.
 * The body skeleton is the shared READER_SHELL_BODY, which the browser extension's reader page uses too.
 */
import * as vscode from "vscode";
import {
  createNonce,
  type PdfTheme,
  PROTOCOL_VERSION,
  type EffectiveTheme,
  type ReaderBootParams,
  type ReaderPrefs,
} from "@labshelf/core";
import { ThemeManager } from "../ThemeManager.js";
import { readerDocument } from "./readerDocument.js";
import { bundleExists, bundleMissingHtml } from "../../ui/bundleMissing/index.js";

export interface RenderParams {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  pdfUri: vscode.Uri;
  paperId: string;
  paperTitle: string;
  themeManager: ThemeManager;
  themePreference: PdfTheme;
  prefs: ReaderPrefs;
  pdfjs: PdfjsFiles | null;
  isMac: boolean;
}

export interface ResolvedUris {
  pdfjsWebviewUri: vscode.Uri;
  workerWebviewUri: vscode.Uri;
  viewerWebviewUri: vscode.Uri;
  viewerCssWebviewUri: vscode.Uri;
  cMapWebviewUrl: string;
  standardFontWebviewUrl: string;
  wasmWebviewUrl: string;
  iccWebviewUrl: string;
}

/** The pdf.js files the reader webview loads, and the package root that holds its cmaps, fonts, wasm and ICC profiles. */
export interface PdfjsFiles {
  pdfjs: vscode.Uri;
  worker: vscode.Uri;
  viewer: vscode.Uri;
  viewerCss: vscode.Uri;
  root: vscode.Uri;
}

/** Finds the installed pdf.js; null when it is not installed. */
export type PdfjsLocator = () => PdfjsFiles | null;

/**
 * Converts the located pdf.js files to webview-safe URIs. The root serves cmaps/, standard_fonts/, wasm/ and iccs/,
 * which the worker fetches at runtime so CJK fonts, Type-1 fonts, JBIG2 and ICC profiles render at full fidelity.
 * @returns A ResolvedUris object with all webview URIs, or null if pdf.js was not located.
 */
export function resolvePdfjsUris(webview: vscode.Webview, files: PdfjsFiles | null): ResolvedUris | null {
  if (!files) { return null; }
  const rootUri = webview.asWebviewUri(files.root).toString().replace(/\/?$/, "/");
  return {
    pdfjsWebviewUri: webview.asWebviewUri(files.pdfjs),
    workerWebviewUri: webview.asWebviewUri(files.worker),
    viewerWebviewUri: webview.asWebviewUri(files.viewer),
    viewerCssWebviewUri: webview.asWebviewUri(files.viewerCss),
    cMapWebviewUrl: `${rootUri}cmaps/`,
    standardFontWebviewUrl: `${rootUri}standard_fonts/`,
    wasmWebviewUrl: `${rootUri}wasm/`,
    iccWebviewUrl: `${rootUri}iccs/`,
  };
}

export interface ReaderBundleUris {
  scriptUri: vscode.Uri;
  styleUri: vscode.Uri;
}

/**
 * Directory holding the esbuild output of the reader webview, for use in localResourceRoots.
 * @returns <extension>/dist/reader
 */
export function getReaderBundleDirectory(extensionUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, "dist", "reader");
}

/**
 * Resolves the bundled reader runtime to webview URIs.
 * @returns the script and stylesheet URIs, or null when the bundle has not been built (dev checkout before `pnpm build`).
 */
export async function resolveReaderBundleUris(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): Promise<ReaderBundleUris | null> {
  const dir = getReaderBundleDirectory(extensionUri);
  const script = vscode.Uri.joinPath(dir, "reader.js");
  if (!(await bundleExists(script))) { return null; }
  return {
    scriptUri: webview.asWebviewUri(script),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dir, "reader.css")),
  };
}

export class PdfRenderer {
  /**
   * Generates the reader's HTML shell. The document carries no behaviour of its own: the bundle reads the JSON boot block and builds the UI.
   * @returns An HTML string ready to assign to webview.html.
   */
  async generateHtml(params: RenderParams): Promise<string> {
    const { webview, extensionUri, pdfUri, paperTitle, themeManager, themePreference } = params;

    const bundle = await resolveReaderBundleUris(webview, extensionUri);
    if (!bundle) { return bundleMissingHtml({ title: paperTitle, heading: "Reader bundle not built", file: "dist/reader/reader.js", reopen: "the PDF" }); }

    const nonce = createNonce();
    const resolved = resolvePdfjsUris(webview, params.pdfjs);
    const effectiveTheme = themeManager.getEffectiveTheme(themePreference) as EffectiveTheme;
    const boot = buildBootParams(params, resolved, webview.asWebviewUri(pdfUri).toString(), effectiveTheme);

    return readerDocument({
      nonce,
      cspSource: webview.cspSource,
      title: paperTitle,
      effectiveTheme,
      assets: boot.assets,
      bootJson: serializeBoot(boot),
      viewerCssUrl: resolved?.viewerCssWebviewUri.toString() ?? "",
      scriptUrl: bundle.scriptUri.toString(),
      styleUrl: bundle.styleUri.toString(),
    });
  }
}

function buildBootParams(
  params: RenderParams,
  resolved: ResolvedUris | null,
  pdfUrl: string,
  effectiveTheme: EffectiveTheme,
): ReaderBootParams {
  return {
    protocolVersion: PROTOCOL_VERSION,
    assets: {
      pdfjsUrl:   resolved?.pdfjsWebviewUri.toString()  ?? "",
      viewerUrl:  resolved?.viewerWebviewUri.toString() ?? "",
      workerUrl:  resolved?.workerWebviewUri.toString() ?? "",
      pdfUrl,
      cMapUrl:    resolved?.cMapWebviewUrl         ?? "",
      stdFontUrl: resolved?.standardFontWebviewUrl ?? "",
      wasmUrl:    resolved?.wasmWebviewUrl         ?? "",
      iccUrl:     resolved?.iccWebviewUrl          ?? "",
    },
    paperId: params.paperId,
    paperTitle: params.paperTitle,
    themePreference: params.themePreference,
    effectiveTheme,
    prefs: params.prefs,
    isMac: params.isMac,
  };
}

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * JSON for an inert <script type="application/json"> block. `<` is escaped so a paper title containing "</script>" cannot terminate the block, and U+2028/2029 because they are line terminators in older parsers.
 * @returns the JSON-encoded boot payload, safe to embed inside a script tag.
 */
export function serializeBoot(boot: ReaderBootParams): string {
  return JSON.stringify(boot)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
