/**
 * Layout shell, breadcrumb, search box and header buttons of the list webview.
 */
export const HEADER_CSS = `
/* ── Layout ── */
.app{display:flex;flex:1;overflow:hidden}
.list-pane{flex:1;display:flex;flex-direction:column;overflow:hidden;min-width:0}
.list-header{
  display:flex;align-items:center;gap:6px;padding:5px 8px;flex-shrink:0;
  border-bottom:1px solid var(--ls-border);background:var(--ls-sidebar-bg);
}
/* ── Breadcrumb ── */
.breadcrumb{display:flex;align-items:center;gap:1px;flex:1;min-width:0;overflow:hidden;white-space:nowrap}
.crumb{
  display:inline-flex;align-items:center;gap:4px;flex-shrink:1;min-width:0;
  padding:2px 5px;border-radius:3px;border:1px solid transparent;
  background:none;color:var(--ls-desc);font-size:12px;cursor:pointer;
}
.crumb>span{overflow:hidden;text-overflow:ellipsis}
.crumb svg{width:13px;height:13px;flex-shrink:0;opacity:.8}
.crumb:hover{background:var(--ls-toolbar-hover);color:var(--ls-fg)}
.crumb.current{color:var(--ls-fg);font-weight:600;font-size:13px;cursor:default;flex-shrink:0}
.crumb.current:hover{background:none}
.crumb-sep{display:inline-flex;width:14px;height:14px;flex-shrink:0;opacity:.5}
.crumb-sep svg{width:14px;height:14px}
/* ── Search ── */
.search-box{
  display:flex;align-items:center;gap:4px;width:280px;flex-shrink:1;min-width:110px;
  padding:0 4px 0 6px;height:24px;border-radius:3px;
  background:var(--ls-input-bg);border:1px solid var(--ls-input-border);
}
.search-box:focus-within{border-color:var(--ls-focus)}
.search-icon{display:inline-flex;width:13px;height:13px;opacity:.6;flex-shrink:0}
.search-icon svg{width:13px;height:13px}
.search-box input{flex:1;min-width:0;border:none;outline:none;background:none;color:var(--ls-input-fg);font:inherit;font-size:12px}
.search-box input::placeholder{color:var(--ls-input-placeholder)}
.search-clear{
  display:none;align-items:center;justify-content:center;width:16px;height:16px;
  border:none;background:none;cursor:pointer;color:var(--ls-fg);opacity:.6;border-radius:3px;
}
.search-clear svg{width:12px;height:12px}
.search-clear:hover{opacity:1;background:var(--ls-toolbar-hover)}
.search-box.has-query .search-clear{display:flex}
.list-header-count:empty{display:none}
.list-header-count{
  font-size:11px;flex-shrink:0;margin-left:4px;border-radius:10px;padding:0 6px;
  background:var(--ls-badge-bg);color:var(--ls-badge-fg);
}
.list-add-btn{
  flex-shrink:0;padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer;border:none;
  background:var(--ls-button-bg);color:var(--ls-button-fg);
}
.list-add-btn:hover{background:var(--ls-button-hover)}
.list-icon-btn{
  flex-shrink:0;display:flex;align-items:center;justify-content:center;
  width:22px;height:22px;border:none;background:none;cursor:pointer;
  border-radius:4px;color:var(--ls-fg);opacity:.75;
}
.list-icon-btn:hover{opacity:1;background:var(--ls-toolbar-hover)}
.list-icon-btn svg{width:15px;height:15px}
.list-icon-btn.active{opacity:1;background:var(--ls-toolbar-active);color:var(--ls-link)}
.list-icon-btn.hidden{display:none}
`;
