// Builds the reader webview's HTML document around the shared reader shell body.
// The boot block is passed in already serialized, so this file never touches the boot payload.
import { escapeHtml, READER_SHELL_BODY, type EffectiveTheme, type ReaderBootParams } from "@labshelf/core";

interface ReaderDocumentParts {
  nonce: string;
  cspSource: string;
  title: string;
  effectiveTheme: EffectiveTheme;
  assets: ReaderBootParams["assets"];
  bootJson: string;
  viewerCssUrl: string;
  scriptUrl: string;
  styleUrl: string;
}

export function readerDocument(parts: ReaderDocumentParts): string {
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
