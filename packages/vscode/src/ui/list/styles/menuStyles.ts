/**
 * Context menu of the list webview.
 */
export const MENU_CSS = `
/* ── Context menu: VS Code's menu tokens ── */
.ctx-menu{
  position:fixed;z-index:100;min-width:230px;max-width:320px;padding:4px 0;border-radius:6px;
  background:var(--ls-menu-bg);
  color:var(--ls-menu-fg);
  border:1px solid var(--ls-menu-border);
  box-shadow:var(--ls-widget-shadow);
}
.ctx-item{
  display:flex;align-items:center;gap:8px;width:calc(100% - 8px);margin:0 4px;padding:3px 8px;border:none;border-radius:4px;
  background:none;cursor:pointer;text-align:left;font-size:12px;line-height:18px;color:inherit;outline:none;
}
.ctx-item:focus,.ctx-item:hover{background:var(--ls-menu-selection-bg);color:var(--ls-menu-selection-fg)}
.ctx-item:disabled{opacity:.45;cursor:default;background:none}
.ctx-item.danger .ctx-label{color:var(--ls-error)}
.ctx-item.danger:focus .ctx-label,.ctx-item.danger:hover .ctx-label{color:inherit}
.ctx-icon{width:16px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;opacity:.85}
.ctx-icon svg{width:14px;height:14px}
.ctx-label{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctx-key{font-size:11px;opacity:.7;padding-left:12px}
.ctx-sep{height:1px;margin:4px 0;background:var(--ls-menu-separator)}
`;
