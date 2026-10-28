/**
 * Renders the detail tabs: the tab bar, the paper tab bar with its counts, and the body of each tab (Details, Annotations,
 * Notes, Related) with the annotation and paper-line pieces other views reuse.
 */
import { deriveRelatedGroups } from "../../listModel.js";
import { describeTextLayer } from "../../folderModel.js";
import { type DetailsTab, CITE_FORMATS } from "../../store/index.js";
import type { PaperNoteView } from "../../protocol/index.js";
import { type PaneState, type PaperView, renderIconButton, renderLoading, renderMuted, renderSection, copyBtn, renderField } from "./paneState.js";
import { formatRelativeTime, formatDateTime } from "../../../time/index.js";
import { ANNOTATION_COLORS, type Annotation, type PaperRecord } from "../../../model/index.js";
import { compareAnnotations } from "../../../reader/index.js";
import { escapeHtml, renderIcon } from "../../../ui/index.js";
import { LIBRARY_LABEL, PDF_FILE, formatBytes, formatAuthors, STATUS_LABEL } from "../../../library/index.js";
import { formatCitation } from "../../copy.js";
import { CITE_LABEL } from "../flows/index.js";
import type { Backlink } from "../../../writing/index.js";

export interface TabSpec {
  id: string;
  label: string;
  /** A count shown after the label. */
  badge?: string;
  /** A dot shown after the label, for "has content". */
  dot?: boolean;
}

export function renderTabBarHtml(tabs: readonly TabSpec[], active: string): string {
  return `<div class="detail-tabs" role="tablist">${tabs.map((t) => {
    const mark = t.badge ? `<span class="tab-badge">${t.badge}</span>` : t.dot ? `<span class="tab-dot" aria-label="has a note"></span>` : "";
    return `<button class="detail-tab${active === t.id ? " active" : ""}" type="button" role="tab" aria-selected="${active === t.id}" data-action="tab" data-tab="${t.id}">${t.label}${mark}</button>`;
  }).join("")}</div>`;
}

export function renderPaperTabBarHtml(pane: PaneState, v: PaperView): string {
  const annotations = v.details?.annotations.length ?? v.stats?.annotations ?? 0;
  const related = deriveRelatedGroups(v.p, v.library, v.similar ?? []).total;
  const tabs: (TabSpec & { id: DetailsTab })[] = [
    { id: "details", label: "Details" },
    { id: "annotations", label: "Annotations", ...(annotations ? { badge: String(annotations) } : {}) },
    { id: "notes", label: "Notes", dot: !!pane.notes.text(v.p.id).trim() },
    { id: "related", label: "Related", ...(related ? { badge: String(related) } : {}) },
  ];
  return renderTabBarHtml(tabs, pane.tab);
}

const FILTER_FROM = 5;

const annText = (a: Annotation): string => a.content.trim();

/** The annotations the filter field and the colour buttons let through, by page. */
export function deriveFilteredAnnotations(pane: PaneState, all: readonly Annotation[]): Annotation[] {
  const f = pane.annFilter.toLowerCase();
  return [...all].sort(compareAnnotations).filter((a) => (!pane.annColor || a.color === pane.annColor) && (!f || annText(a).toLowerCase().includes(f)));
}

/** One annotation as a card that opens the PDF at its page. */
function renderAnnotationCard(a: Annotation): string {
  const isNote = a.type !== "highlight";
  return `<div class="ann-card${a.color ? ` c-${a.color}` : ""}${isNote ? " is-note" : ""}" data-action="open" data-page="${a.pageNumber}" title="Open at page ${a.pageNumber}">` +
    (isNote ? `<span class="ann-kind">${renderIcon("note")}</span>` : "") +
    `<div class="ann-text">${escapeHtml(annText(a))}</div>` +
    `<div class="ann-meta"><span>p. ${a.pageNumber}</span><span class="muted-text">${escapeHtml(formatRelativeTime(a.createdAt))}</span><span class="tb-spacer"></span>` +
      renderIconButton("copyAnnotation", "copy", "Copy as a quote with its citation", ` data-id="${escapeHtml(a.id)}"`) + `</div></div>`;
}

export function renderAnnotationListHtml(pane: PaneState, all: readonly Annotation[]): string {
  const shown = deriveFilteredAnnotations(pane, all);
  if (!shown.length) return renderMuted("No annotation matches.");
  let html = "";
  let page = -1;
  for (const a of shown) {
    if (a.pageNumber !== page) { page = a.pageNumber; html += `<div class="ann-page">Page ${page}</div>`; }
    html += renderAnnotationCard(a);
  }
  return html;
}

function emptyTab(v: PaperView): string {
  return `<div class="tab-empty">${renderIcon("highlighter")}<div>No annotations yet.</div><div class="muted-text">Highlights and notes you make in the reader appear here, by page.</div>` +
    (v.p.hasPdf ? `<button class="ls-btn ls-btn-primary" type="button" data-action="open">${renderIcon("book-open")}<span>Open PDF</span></button>` : "") + `</div>`;
}

function toolbar(pane: PaneState, all: readonly Annotation[]): string {
  const colors = ANNOTATION_COLORS.filter((c) => all.some((a) => a.color === c));
  const count = all.length >= FILTER_FROM
    ? `<input class="mini-input ann-filter" placeholder="Filter ${all.length} annotations" value="${escapeHtml(pane.annFilter)}" spellcheck="false" aria-label="Filter annotations"/>`
    : `<span class="muted-text">${all.length} annotation${all.length === 1 ? "" : "s"}</span><span class="tb-spacer"></span>`;
  const swatches = colors.length > 1 ? colors.map((c) =>
    `<button class="ann-color c-${c}${pane.annColor === c ? " on" : ""}" type="button" data-action="annColor" data-color="${c}" title="Only ${c} highlights" aria-pressed="${pane.annColor === c}"></button>`).join("") : "";
  return `<div class="tab-toolbar">${count}${swatches}` + renderIconButton("copyAnnotations", "copy", "Copy these as Markdown") +
    renderIconButton("exportAnnotations", "download", "Export to a Markdown file…") + `</div>`;
}

export function renderAnnotationsTabHtml(pane: PaneState, v: PaperView): string {
  if (!v.details) return renderLoading("Loading annotations…");
  const all = v.details.annotations;
  if (!all.length) return emptyTab(v);
  return toolbar(pane, all) + `<div class="ann-list">${renderAnnotationListHtml(pane, all)}</div>`;
}

function renderNoteItem(item: PaperNoteView, editable: boolean): string {
  return `<div class="note-item" data-item="${escapeHtml(item.id)}"><div class="note-editor" data-item="${escapeHtml(item.id)}"></div>` +
    (editable ? renderIconButton("removeNote", "trash", "Remove note", ` data-item="${escapeHtml(item.id)}"`) : "") + `</div>`;
}

function notesSection(pane: PaneState, v: PaperView): string {
  const items = pane.notes.items(v.p.id);
  const editable = !pane.ctx.readOnly && !!v.details?.notes;
  const hasHighlights = v.details?.annotations.some((a) => a.type === "highlight") ?? false;
  return `<div class="notes-tab">` + items.map((n) => renderNoteItem(n, editable)).join("") +
    (editable ? `<div class="note-item"><div class="note-editor note-editor-new" aria-label="New note"></div></div>` +
      `<div class="tab-toolbar"><span class="note-state muted-text">Saved automatically with the paper</span><span class="tb-spacer"></span>` +
        (hasHighlights ? `<button class="ls-btn" type="button" data-action="insertHighlights" title="Append your highlights as quotes">${renderIcon("highlighter")}<span>Insert highlights</span></button>` : "") +
        renderIconButton("copyNote", "copy", "Copy notes") + `</div>` : "") +
    `</div>`;
}

export function renderNotesTabHtml(pane: PaneState, v: PaperView): string {
  const pdfNotes = v.details?.annotations.filter((a) => a.type !== "highlight") ?? [];
  const hasItems = pane.notes.items(v.p.id).length > 0;
  const editable = !pane.ctx.readOnly && !!v.details?.notes;
  if (!editable && !hasItems && pdfNotes.length === 0) return renderMuted("No notes.");
  return (editable || hasItems ? notesSection(pane, v) : "") +
    (pdfNotes.length ? renderSection("pdfnotes", "Notes in the PDF", pdfNotes.map(renderAnnotationCard).join(""), pane.collapsed, { count: pdfNotes.length }) : "");
}

function missingPdf(pane: PaneState): string {
  const { findPdf, attachPdf } = pane.ctx.caps;
  const actions = (findPdf ? `<button class="ls-btn" type="button" data-action="findPdf">${renderIcon("search")}<span>Find PDF</span></button>` : "") +
    (attachPdf ? `<button class="ls-btn" type="button" data-action="attachPdf">${renderIcon("paperclip")}<span>Attach PDF…</span></button>` : "");
  return renderMuted("No PDF attached — this paper was saved without one.") + (actions ? `<div class="attach-actions">${actions}</div>` : "");
}

function pdfLine(pane: PaneState, v: PaperView): string {
  const caps = pane.ctx.caps;
  const pdf = v.details?.pdf;
  if (v.details && !pdf) return `<span class="muted-text">Not on this device yet</span>`;
  const link = `<button class="link-btn" type="button" data-action="open" title="${escapeHtml(pdf?.relPath ?? PDF_FILE)}">${PDF_FILE}</button>`;
  const size = pdf ? `<span class="muted-text">${formatBytes(pdf.size)}</span>` : `<span class="muted-text">…</span>`;
  return `<span class="kv-line">${link}${size}` +
    (caps.openExternal ? renderIconButton("openExternal", "external", "Open in the default PDF app") : "") +
    (caps.reveal ? renderIconButton("reveal", "folder", pane.ctx.labels.revealPaper ?? "Reveal folder") : "") + `</span>`;
}

function lastRead(v: PaperView): string {
  const at = v.stats?.lastRead;
  if (!at) return `<span class="muted-text">Never opened</span>`;
  return `<span title="${escapeHtml(formatDateTime(at))}">${escapeHtml(formatRelativeTime(at))}${v.stats?.lastPage ? ` · page ${v.stats.lastPage}` : ""}</span>`;
}

function fileSectionHtml(pane: PaneState, v: PaperView): string {
  if (!v.p.hasPdf) return missingPdf(pane);
  let html = renderField("PDF", pdfLine(pane, v));
  if (pane.ctx.caps.textLayer) html += renderField("Text", `<span class="tl-field">${escapeHtml(describeTextLayer(v.p, v.job))}</span>`);
  html += renderField("Last read", lastRead(v));
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
  return renderSection("citedIn", "Cited in", citedIn.map(citedInRow).join(""), pane.collapsed, { count: citedIn.length });
}

const ABSTRACT_CLAMP_AT = 300;

function abstractBody(pane: PaneState, v: PaperView): string {
  const summary = v.p.summary;
  if (!summary) return renderMuted(pane.ctx.caps.fetchMetadata ? "No abstract. Fetch Metadata Online in the paper menu can often find one." : "No abstract.");
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
  if (p.journal) html += renderField("Publication", escapeHtml(p.journal));
  if (p.publisher && p.publisher !== p.journal) html += renderField("Publisher", escapeHtml(p.publisher));
  if (p.year) html += renderField("Year", escapeHtml(String(p.year)));
  if (p.volume || p.issue) html += renderField("Volume", escapeHtml([p.volume, p.issue ? `(${p.issue})` : ""].filter(Boolean).join(" ")));
  if (p.pages) html += renderField("Pages", escapeHtml(p.pages));
  if (p.doi) html += renderField("DOI", linkLine(`https://doi.org/${p.doi}`, p.doi, "mono", "DOI", p.doi));
  if (p.url && !(p.doi && p.url.includes(p.doi))) html += renderField("URL", linkLine(p.url, p.url.replace(/^https?:\/\/(www\.)?/, ""), "url", "URL", p.url));
  if (p.issn) html += renderField("ISSN", escapeHtml(p.issn));
  if (p.language) html += renderField("Language", escapeHtml(p.language));
  html += renderField("Cite key", `<span class="kv-line"><span class="mono">${escapeHtml(p.citeKey)}</span>${copyBtn(p.citeKey, "cite key")}</span>`);
  html += renderField("Folder", `<button class="link-btn" type="button" data-action="goFolder" title="Open this folder">${escapeHtml((p.relFolder || LIBRARY_LABEL).replaceAll(" / ", " › "))}</button>`);
  return `<div class="kv-grid">${html}</div>`;
}

function citeBody(pane: PaneState, v: PaperView): string {
  const fmt = pane.citeFormat;
  return `<div class="seg-tabs" role="tablist">${CITE_FORMATS.map((f) =>
    `<button class="seg-tab${fmt === f ? " on" : ""}" type="button" role="tab" aria-selected="${fmt === f}" data-action="citeFormat" data-format="${f}">${CITE_LABEL[f]}</button>`).join("")}</div>` +
    `<pre class="cite-box${fmt === "bibtex" ? " code" : ""}">${escapeHtml(formatCitation(v.p, fmt))}</pre>` +
    `<div class="row-end"><button class="ls-btn" type="button" data-action="copyCite" data-format="${fmt}">${renderIcon("copy")}<span>Copy ${CITE_LABEL[fmt]}</span></button></div>`;
}

export function renderDetailsTabHtml(pane: PaneState, v: PaperView): string {
  const keywords = v.p.keywords ?? [];
  return renderSection("abstract", "Abstract", abstractBody(pane, v), pane.collapsed) +
    (keywords.length ? renderSection("keywords", "Keywords", keywordsBody(keywords), pane.collapsed, { count: keywords.length }) : "") +
    renderSection("info", "Info", infoBody(v), pane.collapsed) +
    citedInSectionHtml(pane, v.details?.citedIn) +
    renderSection("cite", "Cite", citeBody(pane, v), pane.collapsed) +
    renderSection("file", "File", fileSectionHtml(pane, v), pane.collapsed);
}

/** One paper in a list of papers, as Related and a multi-selection show them. */
export function renderPaperLine(q: PaperRecord, action: string, title: string, why = ""): string {
  return `<div class="rel-row" data-action="${action}" data-id="${escapeHtml(q.id)}" title="${escapeHtml(title)}">` +
    `<span class="ls-dot s-${q.status}" title="${STATUS_LABEL[q.status]}"></span>` +
    `<div class="rel-main"><div class="rel-title">${escapeHtml(q.title)}</div>` +
      `<div class="rel-sub">${escapeHtml([formatAuthors(q.authors), q.year].filter(Boolean).join(" · "))}${why ? `<span class="rel-why">${escapeHtml(why)}</span>` : ""}</div></div>` +
    (action === "openRelated" ? renderIconButton("open", "book-open", "Open PDF", ` data-id="${escapeHtml(q.id)}"`) : "") + `</div>`;
}

const relRow = (q: PaperRecord, why = ""): string => renderPaperLine(q, "openRelated", "Show this paper — double-click to open it", why);

export function renderRelatedTabHtml(pane: PaneState, v: PaperView): string {
  const g = deriveRelatedGroups(v.p, v.library, v.similar ?? []);
  const c = pane.collapsed;
  let html = "";
  if (pane.ctx.caps.similar && v.similar === null) html += renderSection("relSimilar", "Similar content", renderLoading("Searching the AI index…"), c);
  else if (g.similar.length) html += renderSection("relSimilar", "Similar content", g.similar.map((x) => relRow(x.paper, `${Math.round(x.score * 100)}% match`)).join(""), c, { count: g.similar.length });
  if (g.authors.length) html += renderSection("relAuthors", "Same authors", g.authors.map((q) => relRow(q)).join(""), c, { count: g.authors.length });
  if (g.shared.length) html += renderSection("relShared", "Shared tags & keywords", g.shared.map((x) => relRow(x.paper, x.common.join(", "))).join(""), c, { count: g.shared.length });
  if (g.venue.length) html += renderSection("relVenue", "Same venue", g.venue.map((q) => relRow(q)).join(""), c, { count: g.venue.length });
  return html || `<div class="tab-empty">${renderIcon("link")}<div>No related papers yet.</div><div class="muted-text">Papers that share authors, tags or keywords, or the venue with this one appear here. Tagging papers helps.</div></div>`;
}
