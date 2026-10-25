/**
 * Builds the markup pieces every part of the detail pane uses: collapsible sections with a muted label led by a
 * chevron, label and value rows, icon buttons, copy buttons, muted notes and a loading line.
 */
import { escapeHtml, renderIcon, type IconName } from "../../../ui/index.js";

export interface SectionOptions {
  count?: number;
}

/** A section, open unless the user folded it. */
export function renderSection(id: string, title: string, body: string, collapsed: Record<string, boolean>, o: SectionOptions = {}): string {
  const closed = !!collapsed[id];
  return `<div class="detail-section">` +
    `<div class="sec-head${closed ? " collapsed" : ""}" data-sec="${id}" role="button" tabindex="0" aria-expanded="${!closed}">` +
      `<span class="sec-chevron">${renderIcon("chevron-down")}</span>` +
      `<span class="sec-title">${escapeHtml(title)}</span>` +
      (o.count ? `<span class="sec-count">${o.count}</span>` : "") +
    `</div>` +
    `<div class="sec-body${closed ? " hidden" : ""}" data-sec-body="${id}">${body}</div></div>`;
}

export function renderField(label: string, valueHtml: string): string {
  return `<div class="kv-label">${escapeHtml(label)}</div><div class="kv-value">${valueHtml}</div>`;
}

export function renderIconButton(action: string, name: IconName, title: string, attrs = ""): string {
  return `<button class="ls-icon-btn" type="button" data-action="${action}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"${attrs}>${renderIcon(name)}</button>`;
}

export function copyBtn(text: string, label: string): string {
  return renderIconButton("copyField", "copy", `Copy ${label}`, ` data-text="${escapeHtml(text)}" data-label="${escapeHtml(label)}"`);
}

export function renderMuted(text: string): string {
  return `<div class="muted-note">${escapeHtml(text)}</div>`;
}

export function renderLoading(text = "Loading…"): string {
  return `<div class="muted-note pane-loading"><span class="spin">${renderIcon("loader")}</span>${escapeHtml(text)}</div>`;
}
