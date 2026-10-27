/**
 * Renders the detail head: the Cite, status and More actions dropdowns, the tag row with its field and menu, the
 * text-layer banner, and the single paper's head that puts them together.
 */
import {
  PAPER_STATUSES, STATUS_LABEL, type ReadingStatus, PAPERS_DIR, deriveFamilyName, deriveParentDir, formatVenueLine,
} from "../../../library/index.js";
import { showMenu, type MenuEntry } from "../../../ui/dom/index.js";
import { renderIcon, renderReadingStatusMark, escapeHtml } from "../../../ui/index.js";
import type { CitationFormat } from "../../store/index.js";
import { CITE_LABEL, copyCitation, setReadingStatus, updateTags, splitTags, findFixablePapers } from "../flows/index.js";
import { showPaperMenu } from "../libraryChrome.js";
import type { PaneState, PaperView } from "./paneState.js";
import { countLibraryTags } from "../../listModel.js";
import { hasMissingTextLayer, deriveJobProgress, describeTextLayerJob } from "../../folderModel.js";
import type { UiContext } from "../uiContext.js";
import { isPrePublication } from "../../../model/index.js";
import { ASK_AUTHOR_LABEL, formatPdfRequestedLine } from "../../copy.js";
import { renderVersionChipHtml } from "../list/index.js";

const POPUP = `aria-haspopup="menu" aria-expanded="false"`;

export function renderCitationMenuButton(): string {
  return `<button class="ls-btn ls-btn-ghost cite-btn" type="button" aria-label="Cite" ${POPUP} data-action="citeMenu">` +
    `<span>Cite</span>${renderIcon("chevron-down")}</button>`;
}

/** The status glyph the list's Status column shows, so the button and menu read the same as the list. */
const mark = (status: ReadingStatus): string => `<span class="ls-status-mark s-${status}" aria-hidden="true">${renderReadingStatusMark(status)}</span>`;

/** `null` is a selection whose papers have different statuses: the button says "Status" without a glyph. */
export function renderReadingStatusMenuButton(current: ReadingStatus | null): string {
  return `<button class="ls-btn ls-btn-ghost status-btn" type="button" ${POPUP} data-action="statusMenu" title="Reading status">` +
    `${current ? mark(current) : ""}<span>${current ? STATUS_LABEL[current] : "Status"}</span>${renderIcon("chevron-down")}</button>`;
}

export function renderMoreMenuButton(): string {
  return `<button class="ls-icon-btn head-more" type="button" aria-label="More actions" title="More actions" ${POPUP} data-action="more">${renderIcon("more")}</button>`;
}

function citeEntries(pane: PaneState, ids: readonly string[]): MenuEntry[] {
  return (Object.keys(CITE_LABEL) as CitationFormat[]).map((f) => ({
    label: CITE_LABEL[f],
    onSelect: () => copyCitation(pane.ctx, ids, f),
  }));
}

function statusEntries(pane: PaneState, ids: readonly string[]): MenuEntry[] {
  const papers = pane.ctx.store.get().papers.filter((p) => ids.includes(p.id));
  const statuses = new Set(papers.map((p) => p.status ?? "unread"));
  const current = statuses.size === 1 ? [...statuses][0] : undefined;
  return PAPER_STATUSES.map((status) => ({
    label: STATUS_LABEL[status],
    lead: mark(status),
    ...(current === undefined ? {} : { checked: status === current }),
    onSelect: () => setReadingStatus(pane.ctx, [...ids], status),
  }));
}

/** Opens the menu of a head dropdown; returns false when `action` is not one of them. */
export function runHeadMenu(pane: PaneState, action: string, el: HTMLElement): boolean {
  const ids = [...pane.ctx.store.get().selected];
  const entries = action === "citeMenu" ? citeEntries(pane, ids) : action === "statusMenu" ? statusEntries(pane, ids) : null;
  if (!entries && action !== "more") return false;
  el.setAttribute("aria-expanded", "true");
  const onClose = (): void => el.setAttribute("aria-expanded", "false");
  if (entries) showMenu(el, entries, { onClose });
  else showPaperMenu(pane.ctx, el, onClose);
  return true;
}

function chip(tag: string, readOnly: boolean): string {
  const hash = `<span class="tag-hash" aria-hidden="true">#</span>`;
  const name = `<button class="tag-name" type="button" data-action="searchTag" data-tag="${escapeHtml(tag)}" title="Show papers tagged ${escapeHtml(tag)}">${escapeHtml(tag)}</button>`;
  const remove = `<button class="tag-x" type="button" data-action="removeTag" data-tag="${escapeHtml(tag)}" title="Remove tag" aria-label="Remove tag ${escapeHtml(tag)}">${renderIcon("x")}</button>`;
  return `<span class="tag-chip">${hash}${name}${readOnly ? "" : remove}</span>`;
}

/** The library's tags that not every selected paper carries yet, A to Z. */
function otherTags(ctx: UiContext): string[] {
  const { papers, selected } = ctx.store.get();
  const chosen = papers.filter((p) => selected.has(p.id));
  return countLibraryTags(papers).map(({ tag }) => tag)
    .filter((tag) => !chosen.every((p) => (p.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase())));
}

function tagInput(ctx: UiContext): string {
  return `<span class="tag-field"><input class="tag-input" placeholder="tag" title="Type a tag and press Enter; commas add several" spellcheck="false" autocomplete="off" aria-label="Add tag"/>` +
    `<button class="ls-icon-btn tag-pick" type="button" tabindex="-1" data-action="pickTag" aria-haspopup="menu" aria-label="Choose an existing tag" title="Choose an existing tag"${otherTags(ctx).length ? "" : " disabled"}>${renderIcon("chevron-down")}</button></span>`;
}

// PLATFORM: the pane closes the field when focus leaves it, so the menu hands focus back on close.
/** Lists the library's other tags under `anchor`; picking one adds it to the selection and keeps the field open. */
export function openTagMenu(ctx: UiContext, anchor: HTMLElement): void {
  const ids = [...ctx.store.get().selected];
  const input = anchor.closest(".tag-field")?.querySelector<HTMLInputElement>(".tag-input");
  showMenu(anchor, otherTags(ctx).map((tag) => ({ label: `#${tag}`, onSelect: () => updateTags(ctx, ids, [tag], []) })), {
    onClose: () => { if (input?.isConnected) input.focus(); },
  });
}

/** The row of `tags`; `editing` shows the field in place of the Add tag button. */
export function renderTagRowHtml(ctx: UiContext, tags: readonly string[], editing: boolean): string {
  const add = ctx.readOnly ? "" : editing ? tagInput(ctx)
    : `<button class="ls-icon-btn tag-add" type="button" data-action="addTag" title="Add tag" aria-label="Add tag">${renderIcon("plus")}</button>`;
  return `<div class="tag-row">${tags.map((t) => chip(t, ctx.readOnly)).join("")}${add}</div>`;
}

/** Handles a key in the tag field; `ids` are the papers the row edits, `tags` the ones it shows. */
export function onTagKeydown(ctx: UiContext, e: KeyboardEvent, input: HTMLInputElement, ids: string[], tags: readonly string[]): void {
  if (e.key === "Enter") {
    const add = splitTags(input.value);
    input.value = "";
    updateTags(ctx, ids, add, []);
    e.preventDefault();
  } else if (e.key === "ArrowDown") {
    const pick = input.parentElement?.querySelector<HTMLButtonElement>(".tag-pick");
    if (pick && !pick.disabled) openTagMenu(ctx, pick);
    e.preventDefault();
  } else if (e.key === "Escape") {
    input.value = "";
    ctx.focusList();
    e.preventDefault();
  } else if (e.key === "Backspace" && !input.value && ids.length === 1 && tags.length) {
    updateTags(ctx, ids, [], [tags[tags.length - 1]!]);
    e.preventDefault();
  }
}

/** A comma typed into the field adds what came before it. */
export function onTagInput(ctx: UiContext, input: HTMLInputElement, ids: string[]): void {
  if (!input.value.includes(",")) return;
  const parts = input.value.split(",");
  input.value = parts.pop() ?? "";
  updateTags(ctx, ids, splitTags(parts.join(",")), []);
}

function busyBanner(text: string, progress: number | null): string {
  return `<div class="tl-banner busy"><span class="tl-icon spin">${renderIcon("loader")}</span><div class="tl-text">${escapeHtml(text)}` +
    (progress === null ? "" : `<div class="tl-progress"><progress max="100" value="${progress}"></progress></div>`) + `</div></div>`;
}

function renderTextLayerBanner(v: PaperView): string {
  if (v.job) return busyBanner(describeTextLayerJob(v.job), v.job.phase === "reading" ? deriveJobProgress(v.job) : null);
  if (!hasMissingTextLayer(v.p)) return "";
  const tl = v.p.textLayer!;
  const failed = tl.state === "failed";
  return `<div class="tl-banner"><span class="tl-icon">${renderIcon("file-no-text")}</span><div class="tl-text">` +
    (failed ? "LabShelf could not add a text layer to this PDF." : "No text layer: search and text selection do not work in this PDF.") +
    (tl.reason ? `<div class="tl-reason">${escapeHtml(tl.reason)}</div>` : "") +
    `<button class="ls-btn ls-btn-primary tl-action" type="button" data-action="makeSearchable">${failed ? "Try again" : "Make searchable"}</button></div></div>`;
}

export function renderSelectionBanner(ctx: UiContext, ids: string[]): string {
  const jobs = ctx.store.get().jobs;
  const busy = ids.filter((id) => jobs[id]).length;
  const todo = findFixablePapers(ctx, ids).length;
  if (!todo && !busy) return "";
  if (!todo) return busyBanner(`${busy} of these papers ${busy === 1 ? "is" : "are"} being made searchable…`, null);
  return `<div class="tl-banner"><span class="tl-icon">${renderIcon("file-no-text")}</span><div class="tl-text">` +
    `${todo} of these papers ${todo === 1 ? "has" : "have"} no text layer.` +
    `<button class="ls-btn ls-btn-primary tl-action" type="button" data-action="makeSearchable">Make searchable</button></div></div>`;
}

const FOLD_AUTHORS_ABOVE = 5;
const FOLDED_AUTHORS = 3;

function bylineHtml(pane: PaneState, authors: readonly string[]): string {
  const shown = pane.authorsOpen || authors.length <= FOLD_AUTHORS_ABOVE ? authors : authors.slice(0, FOLDED_AUTHORS);
  const names = shown.map((a) =>
    `<button class="link-btn" type="button" data-action="searchAuthor" data-q="${escapeHtml(deriveFamilyName(a))}" title="Show papers by ${escapeHtml(a)}">${escapeHtml(a)}</button>`).join(", ");
  const more = authors.length > shown.length
    ? ` <button class="link-btn more" type="button" data-action="toggleAuthors">+${authors.length - shown.length} more</button>`
    : pane.authorsOpen && authors.length > FOLD_AUTHORS_ABOVE ? ` <button class="link-btn more" type="button" data-action="toggleAuthors">less</button>` : "";
  return `<div class="detail-byline">${names}${more}</div>`;
}

/**
 * Open PDF (or Continue at the last page), plus Find Published Version for a preprint where the host can search;
 * without a PDF, Find PDF, Attach PDF and Ask the author where the host can, else a disabled "No PDF".
 */
function primaryButtons(pane: PaneState, v: PaperView): string {
  const caps = pane.ctx.caps;
  const lastPage = v.stats?.lastPage ?? 0;
  if (v.p.hasPdf) {
    const title = `Open in the reader (Enter)${lastPage > 1 ? " — it reopens where you left off" : ""}`;
    return `<button class="ls-btn ls-button-soft open-btn" type="button" data-action="open" title="${title}">${renderIcon("book-open")}<span>${lastPage > 1 ? `Continue · p. ${lastPage}` : "Open PDF"}</span></button>` +
      (caps.findPdf && isPrePublication(v.p.pdfVersion) ? findBetterButton(v.pdfBusy) : "");
  }
  const find = caps.findPdf
    ? `<button class="ls-btn ls-button-soft open-btn" type="button" data-action="findPdf"${v.pdfBusy ? " disabled" : ""}>${v.pdfBusy ? `<span class="spin">${renderIcon("refresh")}</span><span>Searching…</span>` : `${renderIcon("search")}<span>Find PDF</span>`}</button>`
    : `<button class="ls-btn ls-button-soft open-btn" type="button" disabled title="This paper has no PDF">${renderIcon("file-minus")}<span>No PDF</span></button>`;
  const attach = caps.attachPdf ? `<button class="ls-btn" type="button" data-action="attachPdf">${renderIcon("paperclip")}<span>Attach PDF…</span></button>` : "";
  const ask = caps.askAuthor ? `<button class="ls-btn" type="button" data-action="askAuthor">${renderIcon("mail")}<span>${ASK_AUTHOR_LABEL}</span></button>` : "";
  return find + attach + ask;
}

function findBetterButton(busy: boolean): string {
  return `<button class="ls-btn" type="button" data-action="findBetterPdf"${busy ? " disabled" : ""}>` +
    (busy ? `<span class="spin">${renderIcon("refresh")}</span><span>Searching…</span>` : `${renderIcon("search")}<span>Find Published Version</span>`) + `</button>`;
}

// The meta line reads venue, version, then the paper's folder (a chevron and its name, which opens it) unless the paper sits at the library root.
function metaHtml(p: PaperView["p"], version: string): string {
  const dir = deriveParentDir(p.path, "/");
  const folder = dir === PAPERS_DIR ? ""
    : `<button class="link-btn" type="button" data-action="goFolder">${renderIcon("chevron-right")}${escapeHtml(dir.slice(dir.lastIndexOf("/") + 1))}</button>`;
  const text = [escapeHtml(formatVenueLine(p)), version].filter(Boolean).join(" · ");
  const line = [text, folder].filter(Boolean).join(" · ");
  return line ? `<div class="detail-meta">${line}</div>` : "";
}

export function renderPaperHeadHtml(pane: PaneState, v: PaperView): string {
  const { p } = v;
  const version = p.hasPdf ? renderVersionChipHtml(p.pdfVersion) : "";
  return `<div class="detail-head">` + renderMoreMenuButton() +
    `<div class="detail-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>` +
    (p.authors?.length ? bylineHtml(pane, p.authors) : "") +
    metaHtml(p, version) +
    (!p.hasPdf && p.pdfRequestedAt ? `<div class="detail-meta">${escapeHtml(formatPdfRequestedLine(p.pdfRequestedAt))}</div>` : "") +
    `<div class="detail-toolbar">${primaryButtons(pane, v)}${renderCitationMenuButton()}</div>` +
    `<div class="detail-status-row">${renderReadingStatusMenuButton(p.status)}${renderTagRowHtml(pane.ctx, p.tags ?? [], pane.tagEditing)}</div>` +
    (pane.ctx.caps.textLayer ? renderTextLayerBanner(v) : "") +
  `</div>`;
}
