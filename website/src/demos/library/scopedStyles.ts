// Adds core's library UI styles to the page, scoped so they style the demo without touching the website around it.
import baseCss from "@labshelf/core/styles/base.css";
import citationMapCss from "@labshelf/core/styles/library-citation-map.css";
import detailCss from "@labshelf/core/styles/library-detail.css";
import listCss from "@labshelf/core/styles/library-list.css";
import tabsCss from "@labshelf/core/styles/library-tabs.css";
import libraryUiCss from "@labshelf/core/styles/library-ui.css";
import toastCss from "@labshelf/core/styles/toast.css";
import tokensCss from "@labshelf/core/styles/tokens.css";
import vscodeHostCss from "@labshelf/core/styles/vscodeHost.css";

// Core mounts menus, dialogs and toasts on the body, outside the demo element, so they join the scope too.
const SCOPE = `[data-demo="library"], body > [class*="ls-"]`;
const SHEETS = [tokensCss, vscodeHostCss, baseCss, toastCss, libraryUiCss, listCss, detailCss, tabsCss, citationMapCss];

/** Wraps a core sheet in `@scope`, so its `:root` tokens land on the scope roots and its element rules stay inside. */
function scopeSheet(css: string): string {
  return `@scope (${SCOPE}) {\n${css.replace(/:root\b/g, ":scope")}\n}`;
}

export function addScopedStyles(): void {
  const style = document.createElement("style");
  style.dataset["demoStyles"] = "library";
  style.textContent = SHEETS.map(scopeSheet).join("\n");
  document.head.append(style);
}
