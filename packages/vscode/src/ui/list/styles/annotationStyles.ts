/**
 * Annotation cards, the note editor and the related-papers list of the detail pane.
 */
export const ANNOTATION_CSS = `
/* ── Annotations ── */
.mini-input{
  flex:1;min-width:0;height:24px;padding:0 8px;border-radius:3px;font:inherit;font-size:12px;outline:none;
  background:var(--ls-input-bg);color:var(--ls-input-fg);border:1px solid var(--ls-input-border);
}
.mini-input:focus{border-color:var(--ls-focus)}
.ann-color{width:14px;height:14px;border-radius:50%;border:2px solid transparent;cursor:pointer;flex-shrink:0;margin:0 1px}
.ann-color.on{border-color:var(--ls-fg)}
.ann-color.c-yellow{background:var(--ls-hl-yellow)}.ann-color.c-green{background:var(--ls-hl-green)}.ann-color.c-blue{background:var(--ls-hl-blue)}
.ann-color.c-red{background:var(--ls-hl-red)}.ann-color.c-pink{background:var(--ls-hl-pink)}
.ann-list{padding:0 14px}
.ann-page{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ls-desc);margin:10px 0 4px}
.ann-card{
  position:relative;padding:6px 8px 4px 11px;margin-bottom:6px;border-radius:4px;cursor:pointer;
  background:var(--ls-widget-bg);border:1px solid var(--ls-border-soft);
}
.ann-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:4px 0 0 4px;background:var(--ls-desc)}
.ann-card.c-yellow::before{background:var(--ls-hl-yellow)}.ann-card.c-green::before{background:var(--ls-hl-green)}.ann-card.c-blue::before{background:var(--ls-hl-blue)}
.ann-card.c-red::before{background:var(--ls-hl-red)}.ann-card.c-pink::before{background:var(--ls-hl-pink)}
.ann-card:hover{border-color:var(--ls-focus)}
.ann-kind{float:left;margin:1px 6px 0 0;display:inline-flex;color:var(--ls-desc)}
.ann-kind svg{width:12px;height:12px}
.ann-text{font-size:12px;line-height:1.5;-webkit-line-clamp:5;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden;user-select:text}
.ann-card.is-note .ann-text{font-style:italic}
.ann-meta{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--ls-desc);margin-top:2px}
.ann-meta .icon-btn{width:20px;height:20px;opacity:0}
.ann-meta .icon-btn svg{width:12px;height:12px}
.ann-card:hover .ann-meta .icon-btn,.ann-meta .icon-btn:focus-visible{opacity:.8}
.sec-body .ann-card{margin-left:-8px}
/* ── Notes ── */
.notes-tab{display:flex;flex-direction:column}
.note-input{
  margin:10px 14px 0;min-height:240px;height:42vh;resize:vertical;padding:8px 10px;border-radius:4px;outline:none;
  font-family:var(--ls-mono);font-size:12.5px;line-height:1.55;
  background:var(--ls-input-bg);color:var(--ls-input-fg);border:1px solid var(--ls-input-border);
}
.note-input:focus{border-color:var(--ls-focus)}
.note-input::placeholder{color:var(--ls-input-placeholder)}
/* ── Related, and the list of a multi-selection ── */
.rel-row{
  display:flex;align-items:center;gap:8px;padding:4px 6px;margin:0 -6px;border-radius:4px;cursor:pointer;
}
.rel-row:hover{background:var(--ls-list-hover)}
.rel-row>.status-dot{margin-top:1px}
.rel-main{flex:1;min-width:0}
.rel-title{font-size:12px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rel-sub{font-size:11px;color:var(--ls-desc);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rel-why{margin-left:6px;font-style:italic}
.rel-why::before{content:'· '}
.rel-row .icon-btn{opacity:0;width:22px;height:22px}
.rel-row:hover .icon-btn,.rel-row .icon-btn:focus-visible{opacity:.8}
.sel-list{padding:4px 14px 16px 20px;border-top:1px solid var(--ls-border-soft)}
`;
