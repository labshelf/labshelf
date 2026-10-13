/**
 * Text-layer indicators on rows and the detail banner with its progress bar.
 */
export const TEXT_LAYER_CSS = `
/* ── Text layer: row icon, "No text" filter, detail banner ── */
.paper-type-icon.no-pdf{opacity:.45}
.paper-type-icon.tl-missing{opacity:1;color:var(--ls-warning)}
.paper-type-icon.tl-busy{opacity:1;color:var(--ls-link)}
.paper-row.selected .paper-type-icon.tl-missing,.paper-row.selected .paper-type-icon.tl-busy{color:inherit}
.status-tab.tl-tab{margin-left:6px;position:relative}
.status-tab.tl-tab::before{content:'';position:absolute;left:-5px;top:4px;bottom:4px;border-left:1px solid var(--ls-border)}
.status-tab.tl-tab svg{width:12px;height:12px;color:var(--ls-warning)}
#tlBanner:empty{display:none}
.tl-banner{
  display:flex;align-items:flex-start;gap:8px;margin-top:4px;padding:7px 9px;border-radius:4px;font-size:11px;line-height:1.45;
  background:var(--ls-warning-bg);
  border:1px solid var(--ls-warning-border);
}
.tl-banner.busy{background:var(--ls-widget-bg);border-color:var(--ls-border)}
.tl-banner>.tl-icon{flex-shrink:0;display:flex;padding-top:1px;color:var(--ls-warning)}
.tl-banner.busy>.tl-icon{color:var(--ls-link)}
.tl-banner svg{width:14px;height:14px}
.tl-banner .tl-text{flex:1;min-width:0}
.tl-banner .tl-reason{margin-top:2px;color:var(--ls-desc);word-break:break-word}
.tl-banner .tl-action{display:inline-flex;margin-top:7px}
.tl-progress{margin-top:6px;height:3px;border-radius:2px;overflow:hidden;background:var(--ls-border)}
.tl-progress>span{display:block;height:100%;min-width:3%;background:var(--ls-progress);transition:width .3s}
`;
