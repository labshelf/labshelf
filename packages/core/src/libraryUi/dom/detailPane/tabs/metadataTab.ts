/**
 * Renders the Details tab: Abstract (folded past a length, copyable), Keywords that search, Info (publication,
 * volume, pages, DOI and URL links with copy, ISSN, language, cite key, folder), Cited in (writing projects), Cite in the
 * chosen style, and File.
 */
import { CITE_FORMATS } from "../../../store/index.js";
import { LIBRARY_LABEL, PDF_FILE, formatBytes, formatDateTime, relativeTime } from "../../../../library/index.js";
import { escapeHtml, icon } from "../../../../ui/index.js";
import { citationText } from "../../../citationText.js";
import { CITE_LABEL } from "../../flows/index.js";
import { copyBtn, kv, muted, section, iconBtn } from "../detailPaneMarkup.js";
import type { PaneState, PaperView } from "../paneState.js";
import type { Backlink } from "../../../../writing/index.js";
import { textLayerSummary } from "../../../viewModel/index.js";

function missingPdf(pane: PaneState): string {
  const { findPdf, attachPdf } = pane.ctx.caps;
  const actions = (findPdf ? `<button class="ls-btn" type="button" data-action="findPdf">${icon("search")}<span>Find PDF</span></button>` : "") +
    (attachPdf ? `<button class="ls-btn" type="button" data-action="attachPdf">${icon("paperclip")}<span>Attach PDF…</span></button>` : "");
  return muted("No PDF attached — this paper was saved without one.") + (actions ? `<div class="attach-actions">${actions}</div>` : "");
}

function pdfLine(pane: PaneState, v: PaperView): string {
  const caps = pane.ctx.caps;
  const pdf = v.details?.pdf;
  if (v.details && !pdf) return `<span class="muted-text">Not on this device yet</span>`;
  const link = `<button class="link-btn" type="button" data-action="open" title="${escapeHtml(pdf?.relPath ?? PDF_FILE)}">${PDF_FILE}</button>`;
  const size = pdf ? `<span class="muted-text">${formatBytes(pdf.size)}</span>` : `<span class="muted-text">…</span>`;
  return `<span class="kv-line">${link}${size}` +
    (caps.openExternal ? iconBtn("openExternal", "external", "Open in the default PDF app") : "") +
    (caps.reveal ? iconBtn("reveal", "folder", pane.ctx.labels.revealPaper ?? "Reveal folder") : "") + `</span>`;
}

function lastRead(v: PaperView): string {
  const at = v.stats?.lastRead;
  if (!at) return `<span class="muted-text">Never opened</span>`;
  return `<span title="${escapeHtml(formatDateTime(at))}">${escapeHtml(relativeTime(at))}${v.stats?.lastPage ? ` · page ${v.stats.lastPage}` : ""}</span>`;
}

function fileSectionHtml(pane: PaneState, v: PaperView): string {
  if (!v.p.hasPdf) return missingPdf(pane);
  let html = kv("PDF", pdfLine(pane, v));
  if (pane.ctx.caps.textLayer) html += kv("Text", `<span class="tl-field">${escapeHtml(textLayerSummary(v.p, v.job))}</span>`);
  html += kv("Last read", lastRead(v));
  return `<div class="kv-grid">${html}</div>`;
}

function citedInRow(link: Backlink): string {
  const where = `${link.file}:${link.line + 1}`;
  return `<button class="rel-row" type="button" data-action="openSource" data-project="${escapeHtml(link.project)}"` +
    ` data-file="${escapeHtml(link.file)}" data-line="${link.line}" title="Open ${escapeHtml(where)}">` +
    `<span class="rel-main"><span class="rel-title">${escapeHtml(link.project)}${link.section ? ` <span class="rel-why">${escapeHtml(link.section)}</span>` : ""}</span>` +
    `<span class="rel-sub mono">${escapeHtml(where)}</span></span></button>`;
}

/** Empty when no project cites the paper or the host knows no projects. */
function citedInSectionHtml(pane: PaneState, citedIn: readonly Backlink[] | undefined): string {
  if (!citedIn?.length) return "";
  return section("citedIn", "Cited in", citedIn.map(citedInRow).join(""), pane.collapsed, { count: citedIn.length });
}

const ABSTRACT_CLAMP_AT = 300;

function abstractBody(pane: PaneState, v: PaperView): string {
  const summary = v.p.summary;
  if (!summary) return muted(pane.ctx.caps.fetchMetadata ? "No abstract. Fetch Metadata Online in the paper menu can often find one." : "No abstract.");
  const long = summary.length > ABSTRACT_CLAMP_AT;
  return `<div class="detail-abstract${long && !pane.abstractOpen ? " clamped" : ""}">${escapeHtml(summary)}</div>` +
    `<div class="abstract-actions">` +
      (long ? `<button class="link-btn more-link" type="button" data-action="toggleAbstract">${pane.abstractOpen ? "Show less" : "Show more"}</button>` : "") +
      `<button class="link-btn more-link" type="button" data-action="copyAbstract">Copy</button></div>`;
}

function keywordsBody(keywords: readonly string[]): string {
  return `<div class="kw-list">${keywords.map((k) =>
    `<button class="kw" type="button" data-action="searchKeyword" data-keyword="${escapeHtml(k)}" title="Find papers with this keyword">${escapeHtml(k)}</button>`).join(`<span class="kw-sep" aria-hidden="true">·</span>`)}</div>`;
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
  html += kv("Folder", `<button class="link-btn" type="button" data-action="goFolder" title="Open this folder">${escapeHtml((p.relFolder || LIBRARY_LABEL).replaceAll(" / ", " › "))}</button>`);
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
  return section("abstract", "Abstract", abstractBody(pane, v), pane.collapsed) +
    (keywords.length ? section("keywords", "Keywords", keywordsBody(keywords), pane.collapsed, { count: keywords.length }) : "") +
    section("info", "Info", infoBody(v), pane.collapsed) +
    citedInSectionHtml(pane, v.details?.citedIn) +
    section("cite", "Cite", citeBody(pane, v), pane.collapsed) +
    section("file", "File", fileSectionHtml(pane, v), pane.collapsed);
}
