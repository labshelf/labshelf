/**
 * Renders the detail head's dropdown buttons (Cite, status, the corner More actions) and opens their menus.
 */
import { PAPER_STATUSES, STATUS_LABEL, type ReadingStatus } from "../../../../library/index.js";
import { showMenu, type MenuEntry } from "../../../../ui/dom/index.js";
import { renderIcon, renderReadingStatusMark } from "../../../../ui/index.js";
import type { CitationFormat } from "../../../store/index.js";
import { CITE_LABEL, copyCitation, setReadingStatus } from "../../flows/index.js";
import { showPaperMenu } from "../../menu/index.js";
import type { PaneState } from "../paneState.js";

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
