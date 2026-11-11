// Adds core's styles to the /open/ page: the sheets the extension's library page loads for the shell, the library, Spaces, Home, notes and the source editor.
import allProjectsCss from "@labshelf/core/styles/all-projects.css";
import baseCss from "@labshelf/core/styles/base.css";
import codeThemesCss from "@labshelf/core/styles/code-themes.css";
import discussionsCss from "@labshelf/core/styles/discussions.css";
import editorAreaCss from "@labshelf/core/styles/editor-area.css";
import figureEditorCss from "@labshelf/core/styles/figure-editor.css";
import homeCss from "@labshelf/core/styles/home.css";
import citeDialogCss from "@labshelf/core/styles/cite-dialog.css";
import detailCss from "@labshelf/core/styles/library-detail.css";
import listCss from "@labshelf/core/styles/library-list.css";
import sidebarCss from "@labshelf/core/styles/library-sidebar.css";
import tabsCss from "@labshelf/core/styles/library-tabs.css";
import libraryUiCss from "@labshelf/core/styles/library-ui.css";
import pageWidgetsCss from "@labshelf/core/styles/page-widgets.css";
import placeHeaderCss from "@labshelf/core/styles/place-header.css";
import qmdDrawingCss from "@labshelf/core/styles/qmd-drawing.css";
import qmdEditorCss from "@labshelf/core/styles/qmd-editor.css";
import qmdNoteUiCss from "@labshelf/core/styles/qmd-note-ui.css";
import sourceToolbarCss from "@labshelf/core/styles/source-editor-toolbar.css";
import spacesCatalogCss from "@labshelf/core/styles/spaces-catalog.css";
import spacesOverviewCss from "@labshelf/core/styles/spaces-overview.css";
import spacesCss from "@labshelf/core/styles/spaces.css";
import toastCss from "@labshelf/core/styles/toast.css";
import pillCss from "@labshelf/core/styles/pill.css";
import tokensCss from "@labshelf/core/styles/tokens.css";

// Each sheet arrives with its @imports inlined (the css-text plugin in build/build.mjs).
const SHEETS = [
  tokensCss, codeThemesCss, baseCss, toastCss, libraryUiCss, listCss, detailCss, tabsCss, sidebarCss, editorAreaCss,
  qmdEditorCss, qmdNoteUiCss, qmdDrawingCss, figureEditorCss, allProjectsCss, pageWidgetsCss, placeHeaderCss,
  spacesCatalogCss, spacesCss, spacesOverviewCss, discussionsCss, homeCss, sourceToolbarCss, pillCss, citeDialogCss,
];

/** Puts core's sheets before the page's own layout sheets, which build on them. */
export function installOpenStyles(): void {
  const style = document.createElement("style");
  style.textContent = SHEETS.join("\n");
  const layout = document.getElementById("share-layout");
  if (layout) { layout.before(style); } else { document.head.append(style); }
}
