// Adds core's library UI styles to the page, scoped so they style the demo without touching the website around it, and keeps the scope roots on the site theme.
import baseCss from "@labshelf/core/styles/base.css";
import citationMapCss from "@labshelf/core/styles/library-citation-map.css";
import detailCss from "@labshelf/core/styles/library-detail.css";
import listCss from "@labshelf/core/styles/library-list.css";
import tabsCss from "@labshelf/core/styles/library-tabs.css";
import libraryUiCss from "@labshelf/core/styles/library-ui.css";
import toastCss from "@labshelf/core/styles/toast.css";
import codeThemesCss from "@labshelf/core/styles/code-themes.css";
import tokensCss from "@labshelf/core/styles/tokens.css";
import vscodeHostCss from "@labshelf/core/styles/vscodeHost.css";
import { onSiteThemeChange, siteTheme } from "../siteTheme.js";

// Core mounts menus, dialogs and toasts on the body, outside the demo element, so they join the scope too.
const SCOPE = `[data-demo="library"], body > [class*="ls-"]`;
const SHEETS = [tokensCss, codeThemesCss, vscodeHostCss, baseCss, toastCss, libraryUiCss, listCss, detailCss, tabsCss, citationMapCss];

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

// Matches the scope selector's body > [class*="ls-"].
const isBodyScopeRoot = (el: Element): boolean => el.parentElement === document.body && (el.getAttribute("class") ?? "").includes("ls-");

/** Sets core's `data-theme` on every scope root, now and on the menus core mounts later, so the demo wears the site theme. */
export function followSiteTheme(container: HTMLElement): void {
  const mark = (el: Element): void => { if (isBodyScopeRoot(el)) el.setAttribute("data-theme", siteTheme()); };
  const markAll = (): void => { container.setAttribute("data-theme", siteTheme()); for (const el of document.body.children) mark(el); };
  markAll();
  onSiteThemeChange(markAll);
  new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) mark(node);
  }).observe(document.body, { childList: true });
}
