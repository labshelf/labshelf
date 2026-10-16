// Builds what the citation map shows instead of its list: the lookup in progress, a failed lookup, or no missing works.

import { escapeHtml, icon } from "../../../ui/index.js";

export function loadingMarkup(): string {
  return `<div class="list-loading"><span class="spin">${icon("loader")}</span> Looking up what your papers cite…</div>`;
}

export function failedMarkup(message: string): string {
  return `<div class="ls-empty"><div class="ls-empty-icon">${icon("warning")}</div>` +
    `<div class="ls-empty-text">The citation map could not be built</div>` +
    `<div class="ls-empty-hint">${escapeHtml(message)}</div>` +
    `<button class="ls-btn" type="button" data-act="refresh">${icon("refresh")}<span>Try again</span></button></div>`;
}

export function emptyMarkup(): string {
  return `<div class="ls-empty"><div class="ls-empty-icon">${icon("link")}</div>` +
    `<div class="ls-empty-text">No often-cited works are missing from your library</div>` +
    `<div class="ls-empty-hint">Works cited by at least 3 of your papers appear here. Only papers with a DOI are looked up, ` +
    `so add DOIs to papers that lack one.</div></div>`;
}
