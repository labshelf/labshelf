/**
 * Detail pane frame, title block, action buttons, status switch and tag chips.
 */
export const DETAIL_HEAD_CSS = `
/* ── Detail pane ── */
.detail-resizer{width:4px;flex-shrink:0;cursor:col-resize;background:transparent;transition:background .1s;border-left:1px solid var(--ls-border)}
.detail-resizer:hover,.detail-resizer.dragging{background:var(--ls-sash-hover)}
.detail-pane{
  position:relative;width:360px;min-width:260px;max-width:760px;flex-shrink:0;
  overflow-y:auto;overflow-x:hidden;background:var(--ls-sidebar-bg);display:flex;flex-direction:column;
}
body.detail-collapsed .detail-pane{display:none}
body.detail-collapsed .detail-resizer{background:var(--ls-sidebar-border)}
.detail-placeholder{
  display:flex;flex-direction:column;align-items:center;gap:10px;
  padding:48px 20px;color:var(--ls-desc);font-size:12px;text-align:center;line-height:1.6;
}
.kbd-help{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 12px;margin-top:8px;font-size:11px}
.kbd-help kbd{margin-right:2px}
/* Header: what the paper is, then what you can do with it. */
.detail-head{padding:12px 14px 12px;display:flex;flex-direction:column;gap:6px}
.detail-title{font-weight:600;font-size:14px;line-height:1.35;user-select:text;overflow-wrap:anywhere}
.detail-byline{font-size:12px;line-height:1.45;color:var(--ls-fg);opacity:.9}
.detail-meta{font-size:11.5px;color:var(--ls-desc);display:flex;flex-wrap:wrap;align-items:center;gap:0 2px}
.detail-meta .venue{font-style:italic}
.dot-sep{margin:0 5px;opacity:.6}
.link-btn{
  border:none;background:none;padding:0;cursor:pointer;color:inherit;text-align:left;
  display:inline-flex;align-items:center;gap:4px;max-width:100%;
}
.link-btn:hover{color:var(--ls-link);text-decoration:underline}
.link-btn svg{width:12px;height:12px;flex-shrink:0;opacity:.8}
.link-btn.more,.more-link{color:var(--ls-link);font-size:11px}
.link-btn.url{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block}
.detail-byline .link-btn{display:inline}
.detail-toolbar{display:flex;align-items:center;gap:2px;margin-top:4px}
.icon-btn{
  flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
  border:none;background:none;cursor:pointer;border-radius:4px;color:var(--ls-fg);opacity:.8;
}
.icon-btn:hover{opacity:1;background:var(--ls-toolbar-hover)}
.icon-btn:focus-visible,.action-btn:focus-visible,.detail-tab:focus-visible,.sec-head:focus-visible{outline:1px solid var(--ls-focus);outline-offset:-1px}
.icon-btn svg{width:15px;height:15px}
.action-btn{
  display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer;border:none;
  background:var(--ls-button2-bg);color:var(--ls-button2-fg);
}
.action-btn svg{width:14px;height:14px;flex-shrink:0}
.action-btn:hover{background:var(--ls-button2-hover)}
.action-btn.primary{background:var(--ls-button-bg);color:var(--ls-button-fg)}
.action-btn.primary:hover{background:var(--ls-button-hover)}
.action-btn:disabled{opacity:.5;cursor:default}
.open-btn{padding:5px 12px}
.status-seg{display:flex;margin-top:4px;border-radius:4px;overflow:hidden;border:1px solid var(--ls-border)}
.status-seg button{
  flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:3px 0;
  border:none;background:none;cursor:pointer;font-size:11px;color:var(--ls-desc);
}
.status-seg button+button{border-left:1px solid var(--ls-border)}
.status-seg button:hover{background:var(--ls-list-hover);color:var(--ls-fg)}
.status-seg button.on{background:var(--ls-list-inactive-bg);color:var(--ls-fg);font-weight:600}
/* Tags: chips you can click to search, x to remove, and an inline field to add. */
.tag-row{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:2px}
.tag-chip{
  display:inline-flex;align-items:center;border-radius:10px;font-size:11px;line-height:18px;
  background:var(--ls-badge-bg);color:var(--ls-badge-fg);
}
.tag-name{border:none;background:none;cursor:pointer;padding:0 2px 0 8px;font-size:11px}
.tag-name:hover{text-decoration:underline}
.tag-x{
  display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;margin-right:2px;
  border:none;background:none;cursor:pointer;border-radius:50%;opacity:.6;
}
.tag-x svg{width:10px;height:10px}
.tag-x:hover{opacity:1;background:var(--ls-toolbar-hover)}
.tag-input{
  flex:1;min-width:70px;max-width:160px;height:20px;padding:0 6px;border-radius:10px;font:inherit;font-size:11px;
  border:1px dashed var(--ls-border);background:none;color:var(--ls-input-fg);outline:none;
}
.tag-input::placeholder{color:var(--ls-desc)}
.tag-input:focus{border-style:solid;border-color:var(--ls-focus);background:var(--ls-input-bg);max-width:none}
`;
