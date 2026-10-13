/**
 * Filter bar, column heads, paper rows, status badges and empty state of the list webview.
 */
export const TABLE_CSS = `
/* ── Filter bar: status tabs + subfolder chips ── */
.filter-bar{
  display:flex;align-items:center;gap:10px;flex-shrink:0;min-height:30px;
  padding:3px 10px;overflow:hidden;border-bottom:1px solid var(--ls-border);
}
.status-filters{display:flex;align-items:center;gap:2px;flex-shrink:0}
.status-tab{
  display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:10px;
  border:none;background:none;cursor:pointer;font-size:11px;color:var(--ls-desc);
}
.status-tab:hover{color:var(--ls-fg);background:var(--ls-toolbar-hover)}
.status-tab.active{color:var(--ls-fg);background:var(--ls-list-inactive-bg);font-weight:600}
.status-tab .n{font-weight:400;opacity:.7}
.status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;flex-shrink:0;background:var(--ls-desc)}
.status-dot.s-unread{background:var(--ls-status-unread)}
.status-dot.s-reading{background:var(--ls-status-reading)}
.status-dot.s-done{background:var(--ls-status-done)}
.sub-strip{
  display:flex;align-items:center;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none;
  padding-left:10px;border-left:1px solid var(--ls-border);
}
.sub-strip::-webkit-scrollbar{display:none}
.sub-strip:empty{display:none}
.sub-chip{
  display:inline-flex;align-items:center;gap:5px;flex-shrink:0;padding:2px 8px;border-radius:3px;
  border:1px solid var(--ls-border);background:none;cursor:pointer;font-size:11px;color:var(--ls-fg);
}
.sub-chip svg{width:12px;height:12px;opacity:.75}
.sub-chip .n{color:var(--ls-desc)}
.sub-chip:hover{background:var(--ls-list-hover);border-color:var(--ls-focus)}
/* While a paper is being dragged, every place it can be dropped lights up. */
body.dragging-papers .sub-chip,body.dragging-papers .crumb:not(.current){border-color:var(--ls-focus);border-style:dashed}
.drop-target{
  background:var(--ls-list-drop-bg) !important;
  outline:1px dashed var(--ls-focus);outline-offset:-1px;
}
/* ── Column heads ── */
.col-heads{
  display:grid;grid-template-columns:var(--cols);padding:3px 4px;flex-shrink:0;user-select:none;
  border-bottom:1px solid var(--ls-border);font-size:11px;color:var(--ls-desc);background:var(--ls-sidebar-bg);
}
.col-heads>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.col-head.sortable{cursor:pointer;display:flex;align-items:center;gap:2px}
.col-head.sortable:hover,.col-head.sorted{color:var(--ls-fg)}
.sort-ind{display:none;width:12px;height:12px;flex-shrink:0}
.sort-ind svg{width:12px;height:12px}
.col-head.sorted .sort-ind{display:inline-flex}
.col-head.sorted.asc .sort-ind{transform:rotate(180deg)}
/* ── Paper rows ── */
.paper-list{flex:1;overflow-y:auto}
.paper-list:focus{outline:none}
.paper-row{
  display:grid;grid-template-columns:var(--cols);align-items:center;padding:4px 4px;min-height:28px;cursor:pointer;
  border-bottom:1px solid var(--ls-border-faint);
}
.paper-row>div{padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.paper-row:hover{background:var(--ls-list-hover)}
.paper-row.cursor:not(.selected){background:var(--ls-list-inactive-bg)}
.paper-row.selected{background:var(--ls-list-active-bg);color:var(--ls-list-active-fg)}
.paper-row.selected .col-meta,.paper-row.selected .match-hint,.paper-row.selected .row-mark{color:var(--ls-list-active-fg)}
.paper-list:focus .paper-row.cursor{outline:1px solid var(--ls-list-focus-outline);outline-offset:-1px}
.paper-row.dragging{opacity:.45}
.paper-type-icon{opacity:.7;display:flex;align-items:center;justify-content:center}
.paper-type-icon svg{width:14px;height:14px}
.col-title{font-size:13px}
.col-meta{font-size:12px;color:var(--ls-desc)}
.title-cell{display:flex;align-items:center;gap:6px;min-width:0}
.title-cell>.title-text{overflow:hidden;text-overflow:ellipsis;min-width:0;flex-shrink:1}
.row-tag,.loc-chip,.match-hint{
  flex-shrink:0;max-width:120px;overflow:hidden;text-overflow:ellipsis;
  font-size:10px;line-height:15px;padding:0 6px;border-radius:8px;
}
.row-tag{
  cursor:pointer;color:var(--ls-fg);
  background:var(--ls-badge-bg);color:var(--ls-badge-fg);opacity:.85;
}
.row-tag:hover{opacity:1;outline:1px solid var(--ls-focus)}
.row-tag.more{cursor:default;outline:none}
.loc-chip{cursor:pointer;color:var(--ls-desc);border:1px solid var(--ls-border)}
.loc-chip:hover{color:var(--ls-fg);border-color:var(--ls-focus)}
.match-hint{color:var(--ls-desc);font-style:italic;padding:0 2px}
.paper-row.selected .row-tag,.paper-row.selected .loc-chip{color:inherit;border-color:currentColor;background:var(--ls-toolbar-hover)}
.row-marks{display:inline-flex;gap:6px;margin-left:auto;padding-left:6px;flex-shrink:0}
.row-mark{display:inline-flex;align-items:center;gap:2px;font-size:10px;color:var(--ls-desc)}
.row-mark svg{width:12px;height:12px}
mark{background:var(--ls-find-match);color:inherit;border-radius:2px}
/* ── Status badges ── */
.badge{
  border:none;cursor:pointer;display:inline-block;padding:1px 7px;border-radius:8px;
  font-size:10px;font-weight:500;vertical-align:middle;
}
.badge-unread{background:var(--ls-badge-bg);color:var(--ls-badge-fg)}
.badge-reading{background:var(--ls-status-reading);color:var(--ls-on-badge)}
.badge-done{background:var(--ls-status-done);color:var(--ls-on-badge)}
.badge:hover{filter:brightness(1.12);outline:1px solid var(--ls-focus)}
/* ── Empty state ── */
.empty-state{
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:64px 24px;gap:10px;color:var(--ls-desc);
}
.empty-icon{opacity:.25;display:flex;justify-content:center}.empty-icon svg{width:44px;height:44px}
.empty-text{font-size:13px}
.empty-hint{font-size:11px;opacity:.6;margin-top:2px}
`;
