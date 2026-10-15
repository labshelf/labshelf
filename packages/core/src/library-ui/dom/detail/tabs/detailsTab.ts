/**
 * Renders the Details tab: Abstract (folded past a length, copyable), Keywords that search, Info (publication,
 * volume, pages, DOI and URL links with copy, ISSN, language, cite key, folder), Cite in the chosen style, and File.
 */
import { CITE_FORMATS } from "../../../state/index.js";
import { PAPERS_DIR, folderLabel } from "../../../../library/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import { CITE_LABEL, citationText } from "../../flows/index.js";
import { copyBtn, iconBtn, kv, muted, section } from "../detailMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";
import { fileSectionHtml } from "./fileSection.js";

const ABSTRACT_CLAMP_AT = 420;

function abstractBody(pane: PaneState, v: PaperView): string {
  const summary = v.p.summary;
  if (!summary) return muted(pane.ctx.caps.fetchMetadata ? "No abstract. Fetch Metadata Online in the paper menu can often find one." : "No abstract.");
  const long = summary.length > ABSTRACT_CLAMP_AT;
  return `<div class="detail-abstract${long && !pane.abstractOpen ? " clamped" : ""}">${escapeHtml(summary)}</div>` +
    (long ? `<button class="link-btn more-link" type="button" data-action="toggleAbstract">${pane.abstractOpen ? "Show less" : "Show more"}</button>` : "");
}

function keywordsBody(keywords: readonly string[]): string {
  return `<div class="kw-list">${keywords.map((k) =>
    `<button class="kw" type="button" data-action="searchKeyword" data-keyword="${escapeHtml(k)}" title="Find papers with this keyword">${escapeHtml(k)}</button>`).join("")}</div>`;
}

function linkLine(href: string, text: string, cls: string, label: string, copy: string): string {
  return `<span class="kv-line"><a class="link-btn ${cls}" href="${escapeHtml(href)}" target="_blank" rel="noopener" title="${escapeHtml(href)}">${escapeHtml(text)}</a>${copyBtn(copy, label)}</span>`;
}

function infoBody(v: PaperView): string {
  const p = v.p;
  let html = "";
  if (p.journal) html += kv("Publication", escapeHtml(p.journal));
  if (p.publisher && p.publisher !== p.journal) html += kv("Publisher", escapeHtml(p.publisher));
  if (p.year) html += kv("Year", escapeHtml(String(p.year)));
  if (p.volume || p.issue) html += kv("Volume", escapeHtml([p.volume, p.issue ? `(${p.issue})` : ""].filter(Boolean).join(" ")));
  if (p.pages) html += kv("Pages", escapeHtml(p.pages));
  if (p.doi) html += kv("DOI", linkLine(`https://doi.org/${p.doi}`, p.doi, "mono", "DOI", p.doi));
  if (p.url && !(p.doi && p.url.includes(p.doi))) html += kv("URL", linkLine(p.url, p.url.replace(/^https?:\/\/(www\.)?/, ""), "url", "URL", p.url));
  if (p.issn) html += kv("ISSN", escapeHtml(p.issn));
  if (p.language) html += kv("Language", escapeHtml(p.language));
  html += kv("Cite key", `<span class="kv-line"><span class="mono">${escapeHtml(p.citeKey)}</span>${copyBtn(p.citeKey, "cite key")}</span>`);
  html += kv("Folder", `<button class="link-btn" type="button" data-action="goFolder" title="Open this folder">${icon("folder")}${escapeHtml(p.relFolder || folderLabel(PAPERS_DIR, v.openFolder, "/"))}</button>`);
  return `<div class="kv-grid">${html}</div>`;
}

function citeBody(pane: PaneState, v: PaperView): string {
  const fmt = pane.citeFormat;
  return `<div class="seg-tabs" role="tablist">${CITE_FORMATS.map((f) =>
    `<button class="seg-tab${fmt === f ? " on" : ""}" type="button" role="tab" aria-selected="${fmt === f}" data-action="citeFormat" data-format="${f}">${CITE_LABEL[f]}</button>`).join("")}</div>` +
    `<pre class="cite-box${fmt === "bibtex" ? " code" : ""}">${escapeHtml(citationText(v.p, fmt))}</pre>` +
    `<div class="row-end"><button class="ls-btn" type="button" data-action="copyCite" data-format="${fmt}">${icon("copy")}<span>Copy ${CITE_LABEL[fmt]}</span></button></div>`;
}

export function detailsTabHtml(pane: PaneState, v: PaperView): string {
  const keywords = v.p.keywords ?? [];
  return section("abstract", "Abstract", abstractBody(pane, v), pane.collapsed, { actions: v.p.summary ? iconBtn("copyAbstract", "copy", "Copy abstract") : "" }) +
    (keywords.length ? section("keywords", "Keywords", keywordsBody(keywords), pane.collapsed, { count: keywords.length }) : "") +
    section("info", "Info", infoBody(v), pane.collapsed) +
    section("cite", "Cite", citeBody(pane, v), pane.collapsed) +
    section("file", "File", fileSectionHtml(pane, v), pane.collapsed);
}
