/**
 * Generates the HTML shell of the PDF reader webview; all behaviour lives in the bundle built by build/webviews.mjs.
 * The body skeleton is the shared READER_SHELL_BODY, which the browser extension's reader page uses too.
 * The shell also resolves the reader theme that follows the VS Code colour theme, which is what the reader's "auto" preference means.
 * Theme colours themselves live in core's reader/themePresets.ts (page pixels) and reader/dom/styles/reader.css (chrome).
 */
import * as vscode from "vscode";
import {
  createNonce,
  PROTOCOL_VERSION,
  type EffectiveTheme,
  type ReaderStartupParams,
  type ReaderPrefs,
  escapeHtml,
  READER_SHELL_BODY,
} from "@labshelf/core";
import { hasBundleFile, renderBundleMissingHtml } from "../ui/index.js";

const THEME_BY_KIND: Record<number, EffectiveTheme> = {
  1: "light",
  2: "dark",
  3: "high-contrast",
  4: "light", // HighContrastLight
};

/** Maps a VS Code ColorThemeKind to a reader theme; unknown kinds read as light. */
export function deriveReaderTheme(kind: number): EffectiveTheme {
  return THEME_BY_KIND[kind] ?? "light";
}

/** The reader theme for the VS Code colour theme that is active now. */
export function readAutoReaderTheme(): EffectiveTheme {
  return deriveReaderTheme(vscode.window.activeColorTheme?.kind ?? 1);
}

/** Calls back with the new reader theme whenever the VS Code colour theme changes. */
export function onAutoReaderThemeChange(callback: (theme: EffectiveTheme) => void): vscode.Disposable {
  return vscode.window.onDidChangeActiveColorTheme((event) => { callback(deriveReaderTheme(event.kind)); });
}

interface ReaderDocumentParts {
  nonce: string;
  cspSource: string;
  title: string;
  effectiveTheme: EffectiveTheme;
  assets: ReaderStartupParams["assets"];
  bootJson: string;
  viewerCssUrl: string;
  scriptUrl: string;
  styleUrl: string;
}

function readerDocument(parts: ReaderDocumentParts): string {
  const { nonce: n, cspSource, title, effectiveTheme, assets, bootJson, viewerCssUrl, scriptUrl, styleUrl } = parts;
  const { pdfjsUrl, viewerUrl, workerUrl, pdfUrl } = assets;
  return `<!doctype html>
<html id="root" lang="en" data-pdf-theme="${escapeHtml(effectiveTheme)}">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${n}' 'wasm-unsafe-eval' ${cspSource}; worker-src ${cspSource} blob:; style-src 'unsafe-inline' ${cspSource}; img-src ${cspSource} blob: data:; connect-src ${cspSource}; font-src ${cspSource};"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
${pdfjsUrl  ? `<link rel="modulepreload" href="${pdfjsUrl}"/>` : ""}
${viewerUrl ? `<link rel="modulepreload" href="${viewerUrl}"/>` : ""}
<link rel="modulepreload" href="${scriptUrl}"/>
${workerUrl ? `<link rel="preload" href="${workerUrl}" as="fetch" crossorigin="anonymous"/>` : ""}
<link rel="preload" href="${pdfUrl}" as="fetch" crossorigin="anonymous"/>
${viewerCssUrl ? `<link rel="stylesheet" href="${viewerCssUrl}"/>` : ""}
<link rel="stylesheet" href="${styleUrl}"/>
</head>
<body>
${READER_SHELL_BODY}
<script id="labshelf-boot" type="application/json">${bootJson}</script>
<script nonce="${n}" type="module" src="${scriptUrl}"></script>
</body>
</html>`;
}

export interface RenderParams {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  pdfUri: vscode.Uri;
  paperId: string;
  paperTitle: string;
  preview: boolean;
  prefs: ReaderPrefs;
  pdfjs: PdfjsFiles | null;
  isMac: boolean;
}

export interface PdfjsUrls {
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
 * @returns A PdfjsUrls object with all webview URIs, or null if pdf.js was not located.
 */
export function resolvePdfjsUris(webview: vscode.Webview, files: PdfjsFiles | null): PdfjsUrls | null {
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
export function readReaderBundleDir(extensionUri: vscode.Uri): vscode.Uri {
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
  const dir = readReaderBundleDir(extensionUri);
  const script = vscode.Uri.joinPath(dir, "reader.js");
  if (!(await hasBundleFile(script))) { return null; }
  return {
    scriptUri: webview.asWebviewUri(script),
    styleUri: webview.asWebviewUri(vscode.Uri.joinPath(dir, "reader.css")),
  };
}

/**
 * Generates the reader's HTML shell. The document carries no behaviour of its own: the bundle reads the JSON boot block and builds the UI.
 * @returns An HTML string ready to assign to webview.html.
 */
export async function renderReaderShell(params: RenderParams): Promise<string> {
  const { webview, extensionUri, pdfUri, paperTitle } = params;

  const bundle = await resolveReaderBundleUris(webview, extensionUri);
  if (!bundle) { return renderBundleMissingHtml({ title: paperTitle, heading: "Reader bundle not built", file: "dist/reader/reader.js", reopen: "the PDF" }); }

  const nonce = createNonce();
  const resolved = resolvePdfjsUris(webview, params.pdfjs);
  const effectiveTheme = readAutoReaderTheme();
  const boot = buildBootParams(params, resolved, webview.asWebviewUri(pdfUri).toString(), effectiveTheme);

  return readerDocument({
    nonce,
    cspSource: webview.cspSource,
    title: paperTitle,
    effectiveTheme,
    assets: boot.assets,
    bootJson: serializeStartup(boot),
    viewerCssUrl: resolved?.viewerCssWebviewUri.toString() ?? "",
    scriptUrl: bundle.scriptUri.toString(),
    styleUrl: bundle.styleUri.toString(),
  });
}

function buildBootParams(
  params: RenderParams,
  resolved: PdfjsUrls | null,
  pdfUrl: string,
  effectiveTheme: EffectiveTheme,
): ReaderStartupParams {
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
    preview: params.preview,
    themePreference: "auto",
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
export function serializeStartup(boot: ReaderStartupParams): string {
  return JSON.stringify(boot)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
