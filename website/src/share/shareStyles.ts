// Adds core's styles to the share page: the library UI's sheets on the folder view, the reader's on a paper.
import baseCss from "@labshelf/core/styles/base.css";
import citationMapCss from "@labshelf/core/styles/library-citation-map.css";
import detailCss from "@labshelf/core/styles/library-detail.css";
import listCss from "@labshelf/core/styles/library-list.css";
import tabsCss from "@labshelf/core/styles/library-tabs.css";
import libraryUiCss from "@labshelf/core/styles/library-ui.css";
import readerCss from "@labshelf/core/styles/reader.css";
import toastCss from "@labshelf/core/styles/toast.css";
import codeThemesCss from "@labshelf/core/styles/code-themes.css";
import tokensCss from "@labshelf/core/styles/tokens.css";

export type ShareView = "library" | "reader";

// Each sheet arrives with its @imports inlined (the css-text plugin in build/build.mjs).
const SHEETS: Record<ShareView, string[]> = {
  library: [tokensCss, codeThemesCss, baseCss, toastCss, libraryUiCss, listCss, detailCss, tabsCss, citationMapCss],
  reader: [tokensCss, codeThemesCss, baseCss, toastCss, readerCss],
};

export function installShareStyles(view: ShareView): void {
  const style = document.createElement("style");
  style.textContent = SHEETS[view].join("\n");
  // After pdf.js' viewer sheet, which reader.css overrides, and before the page's own layout sheet.
  const layout = document.getElementById("share-layout");
  if (layout) layout.before(style);
  else document.head.append(style);
}
