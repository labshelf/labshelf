/** Renders a tab bar from a list of tabs; the host decides the tabs, their badges and which one is active. */

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
