/**
 * Markup pieces every part of the detail pane uses: collapsible sections drawn like a native pane header, label and
 * value rows, icon buttons, copy buttons, muted notes, a loading line and the status segment.
 */
import { PAPER_STATUSES, STATUS_LABEL, type PaperStatus } from "../../../model/index.js";
import { escapeHtml, icon, type IconName } from "../../../ui/index.js";
import { KEY_HINT } from "../uiContext.js";

export interface SectionOptions {
  count?: number;
  /** Icon buttons shown on the header while it is hovered. */
  actions?: string;
}

/** A section, open unless the user folded it. */
export function section(id: string, title: string, body: string, collapsed: Record<string, boolean>, o: SectionOptions = {}): string {
  const closed = !!collapsed[id];
  return `<div class="detail-section">` +
    `<div class="sec-head${closed ? " collapsed" : ""}" data-sec="${id}" role="button" tabindex="0" aria-expanded="${!closed}">` +
      `<div class="sec-head-left"><span class="sec-chevron">${icon("chevron-down")}</span><span class="sec-title">${escapeHtml(title)}</span>` +
      (o.count ? `<span class="sec-count">${o.count}</span>` : "") + `</div>` +
      (o.actions ? `<div class="sec-actions">${o.actions}</div>` : "") +
    `</div>` +
    `<div class="sec-body${closed ? " hidden" : ""}" data-sec-body="${id}">${body}</div></div>`;
}

export function kv(label: string, valueHtml: string): string {
  return `<div class="kv-label">${escapeHtml(label)}</div><div class="kv-value">${valueHtml}</div>`;
}

export function iconBtn(action: string, name: IconName, title: string, attrs = ""): string {
  return `<button class="ls-icon-btn" type="button" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${attrs}>${icon(name)}</button>`;
}

export function copyBtn(text: string, label: string): string {
  return iconBtn("copyField", "copy", `Copy ${label}`, ` data-text="${escapeHtml(text)}" data-label="${escapeHtml(label)}"`);
}

export function muted(text: string): string {
  return `<div class="muted-note">${escapeHtml(text)}</div>`;
}

export function loading(text = "Loading…"): string {
  return `<div class="muted-note pane-loading"><span class="spin">${icon("loader")}</span>${escapeHtml(text)}</div>`;
}

export function statusSeg(current: PaperStatus | null): string {
  return `<div class="status-seg" role="radiogroup" aria-label="Reading status">${PAPER_STATUSES.map((st, i) =>
    `<button class="${current === st ? "on" : ""}" type="button" role="radio" aria-checked="${current === st}" data-action="setStatus" data-status="${st}" title="Mark as ${STATUS_LABEL[st]} (${KEY_HINT.alt}${i + 1})">` +
    `<span class="ls-dot s-${st}"></span>${STATUS_LABEL[st]}</button>`).join("")}</div>`;
}
