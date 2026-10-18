// Adds core's styles to the share page: the library UI's sheets on the folder view, the reader's on a paper.
import baseCss from "@labshelf/core/styles/base.css";
import citationCardCss from "@labshelf/core/styles/citation-card.css";
import citationMapCss from "@labshelf/core/styles/library-citation-map.css";
import detailCss from "@labshelf/core/styles/library-detail.css";
import listCss from "@labshelf/core/styles/library-list.css";
import tabsCss from "@labshelf/core/styles/library-tabs.css";
import libraryUiCss from "@labshelf/core/styles/library-ui.css";
import readerCss from "@labshelf/core/styles/reader.css";
import toastCss from "@labshelf/core/styles/toast.css";
import tokensCss from "@labshelf/core/styles/tokens.css";

export type ShareView = "library" | "reader";

// TRAP: reader.css @imports citation-card.css by a relative URL, which a text import cannot follow.
const SHEETS: Record<ShareView, string[]> = {
  library: [tokensCss, baseCss, toastCss, libraryUiCss, listCss, detailCss, tabsCss, citationMapCss],
  reader: [tokensCss, baseCss, toastCss, citationCardCss, readerCss.replace(/@import[^;]+;/g, "")],
};

export function installShareStyles(view: ShareView): void {
  const style = document.createElement("style");
  style.textContent = SHEETS[view].join("\n");
  // After pdf.js' viewer sheet, which reader.css overrides, and before the page's own layout sheet.
  const layout = document.getElementById("share-layout");
  if (layout) layout.before(style);
  else document.head.append(style);
}
