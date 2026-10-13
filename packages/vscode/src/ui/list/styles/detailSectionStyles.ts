/**
 * Detail pane tabs, collapsible sections and their key-value, abstract and citation content.
 */
export const DETAIL_SECTION_CSS = `
/* Tabs stay in reach while a long tab scrolls. */
.detail-tabs{
  position:sticky;top:0;z-index:2;display:flex;gap:2px;padding:0 10px;flex-shrink:0;
  background:var(--ls-sidebar-bg);border-top:1px solid var(--ls-border-soft);border-bottom:1px solid var(--ls-border);
}
.detail-tab{
  position:relative;display:inline-flex;align-items:center;gap:5px;padding:7px 6px 6px;border:none;background:none;cursor:pointer;
  font-size:11px;letter-spacing:.02em;color:var(--ls-desc);white-space:nowrap;
}
.detail-tab:hover{color:var(--ls-fg)}
.detail-tab.active{color:var(--ls-fg)}
.detail-tab.active::after{content:'';position:absolute;left:4px;right:4px;bottom:-1px;height:2px;background:var(--ls-tab-active-border)}
.tab-badge{
  min-width:16px;padding:0 4px;border-radius:8px;font-size:10px;line-height:15px;text-align:center;
  background:var(--ls-badge-bg);color:var(--ls-badge-fg);
}
.tab-badge.dot{min-width:0;padding:0;background:none;color:var(--ls-link);font-size:14px;line-height:10px}
.tab-body{flex:1;padding-bottom:16px}
.tab-toolbar{display:flex;align-items:center;gap:4px;padding:8px 14px 6px}
.tab-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:32px 20px;text-align:center;font-size:12px}
.tab-empty>svg{width:28px;height:28px;opacity:.35;margin-bottom:4px}
.tab-empty .action-btn{margin-top:8px}
.loading{display:flex;align-items:center;gap:6px;padding:10px 14px;font-style:normal}
.loading svg{width:12px;height:12px}
/* ── Sections: VS Code pane headers ── */
.sec-head{
  display:flex;align-items:center;justify-content:space-between;height:24px;padding:0 8px 0 4px;cursor:pointer;user-select:none;
  font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  color:var(--ls-section-fg);
  background:var(--ls-section-bg);
  border-top:1px solid var(--ls-section-border);
}
.sec-head:hover{background:var(--ls-list-hover)}
.sec-head-left{display:flex;align-items:center;gap:3px;min-width:0}
.sec-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sec-count{margin-left:4px;font-weight:400;opacity:.65}
.sec-chevron{width:16px;height:16px;flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;transition:transform .1s}
.sec-chevron svg{width:16px;height:16px}
.sec-head.collapsed .sec-chevron{transform:rotate(-90deg)}
.sec-actions{display:flex;align-items:center;gap:2px;visibility:hidden}
.sec-head:hover .sec-actions,.sec-head:focus-within .sec-actions{visibility:visible}
.sec-actions .icon-btn{width:20px;height:20px}
.sec-actions .icon-btn svg{width:13px;height:13px}
.sec-body{padding:8px 14px 12px 22px;font-size:12px}
.sec-body.hidden{display:none}
.detail-abstract{line-height:1.55;user-select:text;white-space:pre-wrap}
.detail-abstract.clamped{-webkit-line-clamp:6;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}
.more-link{margin-top:4px}
.kw-list{display:flex;flex-wrap:wrap;gap:4px}
.kw{
  padding:1px 8px;border-radius:10px;cursor:pointer;font-size:11px;background:none;
  color:var(--ls-fg);border:1px solid var(--ls-border);
}
.kw:hover{border-color:var(--ls-focus);color:var(--ls-link)}
/* Label | value on one line each: dense, scannable, and it widens with the pane. */
.kv-grid{display:grid;grid-template-columns:minmax(64px,max-content) minmax(0,1fr);gap:5px 12px;align-items:baseline}
.kv-label{color:var(--ls-desc);font-size:11px;white-space:nowrap}
.kv-value{min-width:0;line-height:1.4;overflow-wrap:anywhere;user-select:text}
.kv-line{display:flex;align-items:center;gap:6px;min-width:0}
.kv-line .icon-btn{width:20px;height:20px;opacity:0}
.kv-line .icon-btn svg{width:12px;height:12px}
.kv-value:hover .kv-line .icon-btn,.kv-line .icon-btn:focus-visible{opacity:.75}
.kv-line .icon-btn:hover{opacity:1}
.seg-tabs{display:flex;flex-wrap:wrap;gap:2px;margin-bottom:6px}
.seg-tab{padding:2px 8px;border-radius:4px;border:none;background:none;cursor:pointer;font-size:11px;color:var(--ls-desc)}
.seg-tab:hover{color:var(--ls-fg);background:var(--ls-toolbar-hover)}
.seg-tab.on{color:var(--ls-fg);background:var(--ls-list-inactive-bg);font-weight:600}
.cite-box{
  margin:0;padding:8px 10px;border-radius:4px;max-height:220px;overflow:auto;user-select:text;
  white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit;font-size:12px;line-height:1.5;
  background:var(--ls-code-bg);border:1px solid var(--ls-border-soft);
}
.cite-box.code{font-family:var(--ls-mono);font-size:11px;white-space:pre}
.row-end{display:flex;justify-content:flex-end;margin-top:6px}
`;
